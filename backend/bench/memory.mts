/**
 * Attributes the backend's resident memory to the workload that raises it.
 *
 *   pnpm bench:memory [--requests 200] [--out memory.json]
 *
 * The baseline reports one number, `peakRssBytes`, for a whole run. That says
 * the peak happened; it does not say what held the memory, and a budget cannot
 * be met by guessing. This separates the three quantities that "memory" is
 * used for and which do not move together:
 *
 *   - **JavaScript heap**, `nodejs_heap_size_used_bytes`. What the program is
 *     holding. A leak lives here.
 *   - **Heap reserved**, `nodejs_heap_size_total_bytes`. What V8 has claimed
 *     from the operating system for that heap. V8 grows it under pressure and
 *     returns it slowly or never, so it is a high-water mark of past demand.
 *   - **External**, `nodejs_external_memory_bytes`, dominated here by the
 *     `Buffer`s that carry CBOR transaction bodies, and by libpq's own
 *     allocations. It is not in the heap and no heap snapshot shows it.
 *
 * Resident memory is roughly the sum of what is currently paged in, so a
 * process whose heap has emptied can still hold a high RSS. Reading RSS alone
 * cannot tell "this route retains 300 MB" from "V8 kept the arena it once
 * needed". Every workload therefore reports the three figures before, at peak
 * and after, and the report states the idle floor the server settles at.
 *
 * A diagnostic, not a gate. It records no verdict and produces no baseline.
 * The server runs the flags `pnpm start` uses and nothing else, so what it
 * measures is the deployed configuration; it is not a baseline because it
 * drives one workload at a time rather than the catalogue.
 *
 * `--profile small` exists to prove the tool works without paying for a
 * target-sized dataset. The measurement that answers the budget uses `target`,
 * which is the default.
 *
 * Requires the same two variables as `bench/cli.mts`.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Client } from "pg";
import { PROFILES } from "./profiles.mjs";
import { runRequests } from "./measure.mjs";
import { buildBackend, setupBench, startServer } from "./harness.mjs";
import { WORKLOADS } from "./workloads.mjs";

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? undefined : process.argv[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
};

const profileName = arg("profile", "target") as keyof typeof PROFILES;
if (!(profileName in PROFILES)) throw new Error(`unknown profile: ${profileName}`);
const requests = Number(arg("requests", "200"));
const outFile = arg("out", "memory.json");
const benchUrl = process.env.BENCH_POSTGRES_URL;
const sourceNodeUrl = process.env.BENCH_SOURCE_NODE_URL;
if (!benchUrl || !sourceNodeUrl) {
  throw new Error("set BENCH_POSTGRES_URL and BENCH_SOURCE_NODE_URL");
}

const API_PORT = 43_512;
const METRICS_PORT = 43_513;

/** One reading of the process, in bytes. */
type Reading = {
  atMs: number;
  /** From `/proc`, the same source the baseline's `peakRssBytes` samples. */
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  /** `large_object` space, where a single allocation over 256 KB lands. */
  largeObjectUsed: number;
  /** Seconds of garbage collection the process has spent in total. */
  gcSeconds: number;
};

const EMPTY: Reading = {
  atMs: 0,
  rss: 0,
  heapUsed: 0,
  heapTotal: 0,
  external: 0,
  largeObjectUsed: 0,
  gcSeconds: 0,
};

/**
 * Reads one Prometheus sample.
 *
 * The exposition format is line based and every line this needs is unlabelled
 * except the heap spaces, so a parser is a regular expression rather than a
 * dependency. A missing metric reads 0 and the report says so by carrying a
 * zero rather than by omitting the row.
 */
const sampleOf = (text: string, name: string, labels = ""): number => {
  const pattern = new RegExp(`^${name}${labels}\\s+([0-9.e+-]+)$`, "m");
  const found = text.match(pattern);
  return found ? Number(found[1]) : 0;
};

const sumOf = (text: string, name: string): number => {
  let total = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${name}{`) && !line.startsWith(`${name} `)) continue;
    const value = Number(line.slice(line.lastIndexOf(" ") + 1));
    if (Number.isFinite(value)) total += value;
  }
  return total;
};

const read = async (startedAt: number): Promise<Reading> => {
  const response = await fetch(`http://127.0.0.1:${METRICS_PORT}/metrics`);
  const text = await response.text();
  return {
    atMs: Math.round(performance.now() - startedAt),
    rss: sampleOf(text, "process_resident_memory_bytes"),
    heapUsed: sampleOf(text, "nodejs_heap_size_used_bytes"),
    heapTotal: sampleOf(text, "nodejs_heap_size_total_bytes"),
    external: sampleOf(text, "nodejs_external_memory_bytes"),
    largeObjectUsed: sampleOf(
      text,
      "nodejs_heap_space_size_used_bytes",
      '\\{space="large_object"\\}',
    ),
    gcSeconds: sumOf(text, "nodejs_gc_duration_seconds_sum"),
  };
};

/**
 * The largest resident mappings in the process, from `/proc/<pid>/smaps`.
 *
 * The three metrics above account for the JavaScript heap and for what V8
 * calls external. They do not account for anything a native module or a
 * WebAssembly instance maps: Prisma's query compiler is WebAssembly, whose
 * linear memory only ever grows, and neither `heapTotal` nor `external`
 * reports it. When resident memory sits far above heap plus external, this is
 * the only place the remainder is visible.
 */
type Mapping = { name: string; rssBytes: number };

/**
 * The kernel's own summary of the process, from `/proc/<pid>/smaps_rollup`.
 *
 * `LazyFree` is the field that settles an argument this measurement keeps
 * running into: pages released with `MADV_FREE` stay resident until the kernel
 * needs them, so a process on an idle machine reports memory it has already
 * given back. If that number is large, resident memory is measuring the
 * absence of memory pressure. If it is zero, the pages are genuinely held.
 */
type Rollup = Record<string, number>;

const rollupOf = (pid: number): Rollup => {
  const wanted = ["Rss", "Pss", "Anonymous", "LazyFree", "Private_Dirty", "Shared_Clean"];
  const out: Rollup = {};
  try {
    for (const line of readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").split("\n")) {
      const found = line.match(/^(\w+):\s+(\d+) kB$/);
      if (found && wanted.includes(found[1] ?? "")) out[found[1] ?? ""] = Number(found[2]) * 1024;
    }
  } catch {
    return out;
  }
  return out;
};

const mappingsOf = (pid: number, top = 12): Mapping[] => {
  let text = "";
  try {
    text = readFileSync(`/proc/${pid}/smaps`, "utf8");
  } catch {
    return [];
  }
  // Anonymous regions are kept apart rather than summed. One 100 MB mapping
  // and four hundred small ones mean different things, and only the first
  // looks like a WebAssembly linear memory or a V8 heap reservation.
  const named = new Map<string, number>();
  const anon: Mapping[] = [];
  let current = "";
  let start = "";
  for (const line of text.split("\n")) {
    const header = line.match(/^([0-9a-f]+)-[0-9a-f]+ \S+ \S+ \S+ \S+\s*(.*)$/);
    if (header) {
      current = (header[2] ?? "").trim();
      start = header[1] ?? "";
      if (current === "") anon.push({ name: `anon @${start}`, rssBytes: 0 });
      continue;
    }
    const rss = line.match(/^Rss:\s+(\d+) kB$/);
    if (!rss) continue;
    const bytes = Number(rss[1]) * 1024;
    if (current === "") {
      const last = anon.at(-1);
      if (last) last.rssBytes += bytes;
    } else {
      named.set(current, (named.get(current) ?? 0) + bytes);
    }
  }
  const rows: Mapping[] = [...named].map(([name, rssBytes]) => ({ name, rssBytes }));
  return [...rows, ...anon]
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, top);
};

/** The highest reading of each field across a set, field by field. */
const peakOf = (readings: readonly Reading[]): Reading =>
  readings.reduce(
    (high, one) => ({
      atMs: one.rss > high.rss ? one.atMs : high.atMs,
      rss: Math.max(high.rss, one.rss),
      heapUsed: Math.max(high.heapUsed, one.heapUsed),
      heapTotal: Math.max(high.heapTotal, one.heapTotal),
      external: Math.max(high.external, one.external),
      largeObjectUsed: Math.max(high.largeObjectUsed, one.largeObjectUsed),
      gcSeconds: Math.max(high.gcSeconds, one.gcSeconds),
    }),
    EMPTY,
  );

type WorkloadMemory = {
  workload: string;
  template: string;
  cacheMode: string;
  requests: number;
  errorRate: number;
  before: Reading;
  peak: Reading;
  /** After the requests finish and the process has been left to settle. */
  after: Reading;
};

const build = buildBackend();
const control = new Client({ connectionString: benchUrl });
await control.connect();

const setup = await setupBench({
  profile: PROFILES[profileName],
  benchUrl,
  sourceNodeUrl,
  poolSize: requests,
});

let server: Awaited<ReturnType<typeof startServer>> | null = null;
const perWorkload: WorkloadMemory[] = [];
const startedAt = performance.now();
let idle: Reading = EMPTY;
let idleMappings: Mapping[] = [];
let finalMappings: Mapping[] = [];
let idleRollup: Rollup = {};
let finalRollup: Rollup = {};

try {
  server = await startServer(setup, API_PORT, {
    METRICS_HOST: "127.0.0.1",
    METRICS_PORT: String(METRICS_PORT),
  });
  const handle = server;

  // The floor. Everything below is read against this, because a server that
  // has answered nothing already holds the Prisma clients, the route table and
  // the schema metadata, and that is not attributable to any workload.
  await new Promise((done) => setTimeout(done, 2_000));
  idle = await read(startedAt);
  idleMappings = mappingsOf(handle.pid);
  idleRollup = rollupOf(handle.pid);

  const selected = WORKLOADS.filter((w) => w.origin === "backend");
  for (const workload of selected) {
    const before = await read(startedAt);
    const readings: Reading[] = [before];

    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        readings.push(await read(startedAt));
        await new Promise((done) => setTimeout(done, 200));
      }
    })();

    const urlFor = (i: number) =>
      `${handle.base}${workload.buildPath(setup.ids[i % setup.ids.length])}`;
    const { samples } = await runRequests(
      urlFor,
      requests,
      workload.concurrency,
      30_000,
      // The same cache decision the baseline makes for this row. Bypassing a
      // warm workload would measure a route the baseline never ran.
      workload.cacheMode === "cold" ? { bypass: handle.bypassToken } : undefined,
    );

    sampling = false;
    await sampler;

    // Five seconds of quiet before the closing reading. V8 collects when it
    // is pressured, not on request, so this is what the process settles at
    // rather than what a forced collection could reclaim. `heapUsed` here
    // above `before` is what the workload has not released.
    await new Promise((done) => setTimeout(done, 5_000));
    const after = await read(startedAt);

    perWorkload.push({
      workload: workload.name,
      template: workload.template,
      cacheMode: workload.cacheMode,
      requests: samples.length,
      errorRate:
        samples.filter((s) => s.timedOut || s.status >= 400).length /
        Math.max(1, samples.length),
      before,
      peak: peakOf(readings),
      after,
    });

    const mib = (n: number) => (n / 1024 ** 2).toFixed(1).padStart(7);
    console.log(
      `${workload.name.padEnd(28)} rss ${mib(before.rss)} -> ${mib(peakOf(readings).rss)} ` +
        `(after ${mib(after.rss)})  heap ${mib(peakOf(readings).heapUsed)}  ` +
        `ext ${mib(peakOf(readings).external)}`,
    );
  }
  finalMappings = mappingsOf(handle.pid);
  finalRollup = rollupOf(handle.pid);
} finally {
  await server?.stop();
  await setup.cleanup();
  await control.end().catch(() => {});
}

const report = {
  kind: "memory-attribution",
  build,
  profile: profileName,
  requestsPerWorkload: requests,
  datasetRows: setup.datasetChecksum.rows,
  /** What the baseline would have recorded for this process. */
  peakRssBytes: server?.peakRssBytes() ?? 0,
  idle,
  idleMappings,
  idleRollup,
  finalMappings,
  finalRollup,
  workloads: perWorkload,
  finishedAt: new Date().toISOString(),
};

await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);

const mib = (n: number) => (n / 1024 ** 2).toFixed(1);
console.log(`\nidle floor: rss ${mib(idle.rss)} MiB, heap ${mib(idle.heapUsed)} MiB`);
console.log(`process peak rss: ${mib(report.peakRssBytes)} MiB`);
for (const m of finalMappings) console.log(`  ${mib(m.rssBytes).padStart(8)} MiB  ${m.name}`);
console.log("kernel rollup, idle then final:");
for (const key of Object.keys(finalRollup)) {
  console.log(`  ${key.padEnd(14)} ${mib(idleRollup[key] ?? 0).padStart(8)} -> ${mib(finalRollup[key] ?? 0).padStart(8)} MiB`);
}
console.log(`written to ${outFile}`);
