import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Client } from "pg";
import { cloneIndex, type IndexSnapshot } from "./cloneIndex.mjs";
import { captureEnvironment, environmentWarnings, type EnvironmentReport } from "./environment.mjs";
import { generateDataset, LOAD_ORDER } from "./generate.mjs";
import { judge, type Judgement } from "./judge.mjs";
import { identitySize, runRequests, summarise } from "./measure.mjs";
import { createDbProbe, ZERO_WORK, type DbWork } from "./pgStats.mjs";
import { PROFILES, type Profile } from "./profiles.mjs";
import { seedDataset } from "./seedShaped.mjs";
import { WORKLOADS, type SeededIds, type Workload } from "./workloads.mjs";
import {
  adminUrl,
  checksum,
  createDatabase,
  dropDatabase,
  stripPsqlMeta,
  type Checksum,
} from "../test/helpers/throwawayDb.mjs";
import { readFile } from "node:fs/promises";

/**
 * The benchmark orchestrator.
 *
 * Builds an isolated environment, runs the workload catalogue against a real
 * server, and judges each result. Everything it produces is JSON, so a run can
 * be compared with a later one rather than remembered.
 *
 * Two databases, both on the dedicated benchmark server: the seeded node
 * schema and a frozen copy of the real L1 index. They live on one instance so a
 * single `pg_stat_statements` reset covers both, which is what makes a
 * "statements per request" figure span the dual-database routes honestly.
 */

const FIXTURE = "test/fixtures/schema/midgard-node.sql";

export type BenchSetup = {
  nodeDb: string;
  indexDb: string;
  nodeUrl: string;
  indexUrl: string;
  datasetChecksum: Checksum;
  indexSnapshot: IndexSnapshot;
  /** A pool, not one row: unique-key workloads rotate through it. */
  ids: SeededIds[];
  cleanup: () => Promise<void>;
};

/**
 * Identifiers taken from the seeded data, never invented.
 *
 * A hand-written hash 404s, and a 404 is fast, confident and meaningless. The
 * pool is drawn in the same order every time so a run is reproducible.
 */
export async function resolveSeededIds(
  node: Client,
  size = 50,
): Promise<SeededIds[]> {
  const blocks = await node.query<{ h: string }>(
    `SELECT encode(header_hash, 'hex') AS h FROM pending_block_finalizations
      ORDER BY block_end_time DESC, encode(header_hash, 'hex') DESC LIMIT $1`,
    [size],
  );
  const txs = await node.query<{ t: string }>(
    `SELECT encode(tx_id, 'hex') AS t FROM immutable
      WHERE octet_length(tx) < 65536 ORDER BY encode(tx_id, 'hex') LIMIT $1`,
    [size],
  );
  const addresses = await node.query<{ a: string }>(
    // Busiest first: a uniformly drawn address has one entry and its page
    // measures nothing. The hot addresses are the pages that hurt.
    `SELECT address AS a FROM address_history
      GROUP BY address ORDER BY count(*) DESC, address ASC LIMIT $1`,
    [size],
  );
  if (blocks.rowCount === 0 || txs.rowCount === 0 || addresses.rowCount === 0) {
    throw new Error("seeded database has no blocks, transactions or addresses");
  }
  return Array.from({ length: size }, (_, i) => ({
    blockHash: blocks.rows[i % blocks.rows.length].h,
    txId: txs.rows[i % txs.rows.length].t,
    address: addresses.rows[i % addresses.rows.length].a,
    // Deep enough to be a real page, bounded by what was seeded.
    page: 1 + (i % Math.max(1, Math.min(100, Math.floor(blocks.rows.length / 2)))),
  }));
}

export type SetupOptions = {
  profile: Profile;
  /** The dedicated benchmark server. Never the live node or index. */
  benchUrl: string;
  /** The live explorer index, read-only, cloned into the benchmark server. */
  liveIndexUrl: string;
};

export async function setupBench(options: SetupOptions): Promise<BenchSetup> {
  const { profile, benchUrl, liveIndexUrl } = options;

  const indexDb = await createDatabase(benchUrl);
  const indexClient = new Client({ connectionString: adminUrl(indexDb, benchUrl) });
  await indexClient.connect();
  const source = new Client({ connectionString: liveIndexUrl });
  await source.connect();
  const indexSnapshot = await cloneIndex(source, indexClient);
  await source.end();

  const nodeDb = await createDatabase(benchUrl);
  const nodeClient = new Client({ connectionString: adminUrl(nodeDb, benchUrl) });
  await nodeClient.connect();
  await nodeClient.query(stripPsqlMeta(await readFile(FIXTURE, "utf8")));

  // The real L2 header hashes from the snapshot settle the generated blocks,
  // so the cross-source routes agree with real data rather than a re-derivation.
  const dataset = generateDataset(profile, {
    settledHashes: indexSnapshot.settledHashes,
  });
  await seedDataset(nodeClient, dataset);
  const datasetChecksum = await checksum(nodeClient, [...LOAD_ORDER]);
  const ids = await resolveSeededIds(nodeClient);

  return {
    nodeDb,
    indexDb,
    nodeUrl: adminUrl(nodeDb, benchUrl),
    indexUrl: adminUrl(indexDb, benchUrl),
    datasetChecksum,
    indexSnapshot,
    ids,
    cleanup: async () => {
      await nodeClient.end().catch(() => {});
      await indexClient.end().catch(() => {});
      await dropDatabase(nodeDb, benchUrl);
      await dropDatabase(indexDb, benchUrl);
    },
  };
}

export type ServerHandle = {
  base: string;
  bypassToken: string;
  /** `null` while the process is alive, the exit code once it is not. */
  exitCode: () => number | null;
  /** Whatever the server printed. The reason a mid-run death is explainable. */
  output: () => string;
  stop: () => Promise<void>;
};

/**
 * Starts the built backend against the benchmark databases.
 *
 * A child process rather than an in-process import: `config` and the Prisma
 * clients are module singletons read at import time, so pointing them at other
 * databases from inside a test that has already imported them is not possible
 * without leaking that state into every other test in the worker.
 */
/**
 * The per-client request allowance given to the benchmark server.
 *
 * High enough that no run can reach it: `stress` is twelve workloads and the
 * iteration count is a parameter, so this must not become a new invisible
 * ceiling. Recorded in the report, because a latency number means nothing
 * without the configuration it was measured under.
 */
export const BENCH_RATE_LIMIT_MAX = 1_000_000;

export async function startServer(
  setup: BenchSetup,
  port: number,
  extraEnv: Record<string, string> = {},
): Promise<ServerHandle> {
  const bypassToken = randomBytes(24).toString("hex");
  const child: ChildProcess = spawn(process.execPath, ["dist/index.js"], {
    env: {
      ...process.env,
      POSTGRES_URL: setup.nodeUrl,
      INDEXER_POSTGRES_URL: setup.indexUrl,
      BACKEND_PORT: String(port),
      BENCH_CACHE_BYPASS_TOKEN: bypassToken,
      // Production mode on purpose: logging verbosity and error handling
      // differ, and measuring the development configuration would measure
      // something nobody deploys. That makes the production CORS guard apply,
      // which refuses a wildcard, so the harness names its own origin.
      CORS_ORIGIN: `http://127.0.0.1:${port}`,
      // The indexer would write to the frozen snapshot and move the data the
      // benchmark is measuring against.
      L1_SYNC_ENABLED: "false",
      NODE_ENV: "production",
      // The server rate-limits per client at 120 requests a minute. A run is
      // twelve workloads of 40 requests from one address, so the first three
      // workloads consumed the whole allowance and every workload after them
      // measured a 429: sub-millisecond, zero bytes, no database work. The
      // limiter middleware still runs and its per-request cost is still in the
      // numbers; only the threshold moves, because the benchmark client is not
      // a viewer and throttling it measures the limiter rather than the route.
      API_RATE_LIMIT_MAX: String(BENCH_RATE_LIMIT_MAX),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const base = `http://127.0.0.1:${port}`;
  // `/healthz`, taken from `catalogue.ts:212`. An earlier version probed
  // `/api/health`, which the backend does not serve, so the wait timed out
  // against a server that was already up. This is the same defect the workload
  // catalogue exists to prevent: a hand-written path that 404s.
  const healthPath = "/healthz";
  const deadline = Date.now() + 60_000;
  // Accumulated, not overwritten: a config failure prints its reason first and
  // the stack last, so keeping only the final chunk loses the reason.
  let stderr = "";
  let lastStatus: number | string = "no response";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const failure = () => stderr.trim().split("\n").slice(0, 12).join("\n");

  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with ${child.exitCode}:\n${failure()}`);
    }
    try {
      const probe = await fetch(`${base}${healthPath}`);
      lastStatus = probe.status;
      if (probe.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(
        `server did not become healthy in 60s; last ${healthPath} status: ${lastStatus}\n${failure()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    base,
    bypassToken,
    exitCode: () => child.exitCode,
    output: failure,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

export type RunOptions = {
  /** Requests per workload. Enough for a p99 to mean something. */
  iterations?: number;
  timeoutMs?: number;
};

/**
 * Runs one workload and judges it.
 *
 * The cache mode decides how requests are shaped, and it is the difference
 * between measuring a route and measuring a five-second cache:
 *
 *   - `cold` sends the bypass token, so neither cache layer is read or written;
 *   - `warm` primes once and then measures, which is the cache on purpose;
 *   - `unique-key` rotates the seeded id pool, so every request is a distinct
 *     cache key and the cache never serves one. That is realistic detail-page
 *     traffic, and it is not the same as bypassing.
 */
export async function runWorkload(
  workload: Workload,
  setup: BenchSetup,
  server: ServerHandle,
  probe: Awaited<ReturnType<typeof createDbProbe>>,
  options: RunOptions = {},
): Promise<Judgement> {
  const iterations = options.iterations ?? (workload.concurrency > 1 ? 200 : 40);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pool = setup.ids;

  const urlFor = (i: number) => {
    const ids = workload.cacheMode === "unique-key" ? pool[i % pool.length] : pool[0];
    return `${server.base}${workload.buildPath(ids)}`;
  };

  if (workload.cacheMode === "warm") {
    // Prime, so the measured requests are the cached path this row is about.
    await runRequests(urlFor, 2, 1, timeoutMs);
  }

  const headers =
    workload.cacheMode === "cold" ? { bypass: server.bypassToken } : undefined;

  await probe.reset();
  const { samples, elapsedMs } = await runRequests(
    urlFor,
    iterations,
    workload.concurrency,
    timeoutMs,
    headers,
  );
  const totals = probe.available ? await probe.read() : ZERO_WORK;

  // Budgets are per request. Cluster totals divided by the requests that
  // produced them, which is why nothing else may touch this server during a run.
  const perRequest: DbWork = {
    statements: totals.statements / Math.max(1, samples.length),
    sharedBlocks: totals.sharedBlocks / Math.max(1, samples.length),
    tempBytes: totals.tempBytes / Math.max(1, samples.length),
    execMs: totals.execMs / Math.max(1, samples.length),
  };

  const identity =
    workload.budget.maxUncompressedBytes === undefined
      ? 0
      : await identitySize(urlFor(0), timeoutMs);

  return judge({
    workload,
    stats: summarise(samples, elapsedMs, identity),
    dbWork: perRequest,
    dbProbeAvailable: probe.available,
  });
}

/**
 * The hardware a result was taken on, stamped onto every report.
 *
 * `existing-minimum-2-core` is the accepted minimum supported runtime profile:
 * `docs/resource-requirements.md:47` states two cores are enough for `demo` and
 * `existing`, and every measurement there was taken on two. Runtime latency,
 * database work, payload and concurrency budgets may be judged on it, because
 * scheduler pressure is part of performance on the supported minimum. It is
 * **not** universal production hardware, which is why results carry the stamp
 * rather than being presented as unqualified.
 */
export type HardwareProfile = "existing-minimum-2-core" | "unclassified";

export function hardwareProfileOf(environment: EnvironmentReport): HardwareProfile {
  return environment.cpuCount <= 2 ? "existing-minimum-2-core" : "unclassified";
}

/**
 * Budgets that may never be judged on the minimum profile.
 *
 * Suite wall time is a property of the developer and CI runner, not of the
 * supported runtime, so it needs a quiet standardised machine and stays
 * deferred. Runtime budgets do not: the minimum is a machine users actually
 * run on.
 */
export const EXCLUDED_ON_MINIMUM_HARDWARE = [
  "backend test suite wall time",
] as const;

export type HarnessReport = {
  /** `smoke` proves the harness works. `baseline` is the measurement of record. */
  mode: "smoke" | "baseline";
  /** Stamped on every result. See `HardwareProfile`. */
  hardware: HardwareProfile;
  profile: string;
  environment: EnvironmentReport;
  warnings: string[];
  datasetChecksum: Checksum;
  indexChecksum: Checksum;
  iterations: number;
  /** What the measured server was configured with, so a number can be read. */
  serverConfig: { apiRateLimitMax: number };
  /**
   * Which part of the catalogue this run covers.
   *
   * `backend-only` is the honest name for what a harness run measures: the
   * catalogue holds frontend-origin rows the backend does not serve. The first
   * `target` run reported twelve of thirteen workloads with no mention of the
   * thirteenth, which read as full coverage.
   */
  scope: "backend-only" | "subset";
  /** Every catalogue workload, either measured or excluded with a reason. */
  coverage: {
    measured: string[];
    excluded: { workload: string; reason: string }[];
  };
  results: Judgement[];
  startedAt: string;
  finishedAt: string;
};

/**
 * Conditions under which a run may be recorded as a baseline.
 *
 * Returned as reasons rather than a boolean, because "not a baseline" is only
 * useful if it says why. A smoke run ignores these; a baseline run must not.
 */
export function baselineGate(
  environment: EnvironmentReport,
  results: readonly Judgement[],
  coverage?: {
    scope: "backend-only" | "subset";
    excluded: readonly { workload: string; reason: string }[];
  },
): string[] {
  const blocking: string[] = [];
  const GB = 1024 ** 3;


  // A subset is a diagnostic run. Only a full backend sweep is a baseline.
  if (coverage?.scope === "subset") {
    blocking.push(
      "only a subset of the catalogue ran: a baseline covers every " +
        "backend-origin workload",
    );
  }

  // Coverage is checked against the catalogue, not taken on trust. Recording an
  // exclusion list and never validating it would leave exactly the hole this
  // closes: a workload can go missing and the report still reads complete.
  if (coverage) {
    const known = new Set(WORKLOADS.map((w) => w.name));
    const expected = WORKLOADS.filter((w) => w.origin === "backend").map((w) => w.name);
    const measured = results.map((r) => r.workload);
    const seen = new Map<string, number>();
    for (const name of measured) seen.set(name, (seen.get(name) ?? 0) + 1);

    for (const [name, times] of seen) {
      if (!known.has(name)) {
        blocking.push(`measured "${name}", which is not in the catalogue`);
      }
      if (times > 1) {
        blocking.push(`"${name}" was measured ${times} times: a workload appears once`);
      }
    }
    if (coverage.scope === "backend-only") {
      for (const name of expected) {
        if (!seen.has(name)) {
          blocking.push(`backend workload "${name}" is missing from the results`);
        }
      }
    }

    const excludedNames = new Set<string>();
    for (const entry of coverage.excluded) {
      if (!known.has(entry.workload)) {
        blocking.push(`excluded "${entry.workload}", which is not in the catalogue`);
      }
      if (entry.reason.trim() === "") {
        blocking.push(`exclusion of "${entry.workload}" gives no reason`);
      }
      if (seen.has(entry.workload)) {
        blocking.push(`"${entry.workload}" is both measured and excluded`);
      }
      excludedNames.add(entry.workload);
    }

    // Every catalogue row lands in exactly one of the two sets.
    for (const workload of WORKLOADS) {
      if (!seen.has(workload.name) && !excludedNames.has(workload.name)) {
        blocking.push(
          `"${workload.name}" is neither measured nor excluded: the report does ` +
            `not account for it`,
        );
      }
    }
  }
  if (environment.freeDiskBytes >= 0 && environment.freeDiskBytes < 30 * GB) {
    blocking.push(
      `needs 30 GB free before starting, found ${(environment.freeDiskBytes / GB).toFixed(1)} GB: PostgreSQL needs WAL and temp headroom, and a starved filesystem is what the timing would describe`,
    );
  }
  // Core count is deliberately NOT blocking. Two cores is the accepted minimum
  // supported runtime profile, and scheduler pressure there is part of
  // performance rather than a distortion of it. The result carries
  // `hardware: "existing-minimum-2-core"` so nobody reads it as universal
  // production hardware. Suite wall time is the exception and is excluded by
  // EXCLUDED_ON_MINIMUM_HARDWARE, not by this gate.
  for (const result of results) {
    if (result.unmeasured.length > 0) {
      blocking.push(`${result.workload} has unmeasured budgets: ${result.unmeasured[0]}`);
    }
    // Distinct from a failing budget. A workload where nothing succeeded
    // measured nothing, and a FAIL verdict would misread it as "too slow"
    // rather than "never ran". This gate previously passed such a run with no
    // warnings at all.
    if (result.stats.errorRate >= 1) {
      blocking.push(
        `${result.workload} produced no successful responses: the run measured nothing`,
      );
    }
  }
  return blocking;
}

/** Runs the catalogue end to end and writes a JSON report. */
export async function runHarness(options: {
  profileName: keyof typeof PROFILES;
  benchUrl: string;
  liveIndexUrl: string;
  port: number;
  mode: "smoke" | "baseline";
  only?: readonly string[];
  outFile?: string;
  run?: RunOptions;
}): Promise<HarnessReport> {
  const startedAt = new Date().toISOString();
  const profile = PROFILES[options.profileName];
  const control = new Client({ connectionString: options.benchUrl });
  await control.connect();
  const environment = await captureEnvironment(control);
  const probe = await createDbProbe(control);

  const setup = await setupBench({
    profile,
    benchUrl: options.benchUrl,
    liveIndexUrl: options.liveIndexUrl,
  });
  let server: ServerHandle | null = null;
  try {
    server = await startServer(setup, options.port);
    const wanted = options.only;
    const selected = wanted
      ? WORKLOADS.filter((w) => wanted.includes(w.name))
      : WORKLOADS.filter((w) => w.origin === "backend");
    // Every catalogue row is accounted for, so a missing one is a stated
    // exclusion rather than an absence nobody can see in the report.
    const excluded = WORKLOADS.filter((w) => !selected.includes(w)).map((w) => ({
      workload: w.name,
      reason: wanted
        ? "not in the requested subset"
        : `origin is ${w.origin}: not served by the backend under test`,
    }));
    const scope = wanted ? ("subset" as const) : ("backend-only" as const);
    const results: Judgement[] = [];
    for (const workload of selected) {
      results.push(await runWorkload(workload, setup, server, probe, options.run));
      // A dead server answers every request in under a millisecond with a
      // refused connection, which reads as a fast workload with a 100% error
      // rate. Without this check a crash after the third workload produced nine
      // more rows of numbers that described nothing, and the report gave no
      // reason. Stop at the first one and carry the server's own output.
      const code = server.exitCode();
      if (code !== null) {
        throw new Error(
          `the server exited with ${code} during "${workload.name}". Results up ` +
            `to that point are not a measurement:\n${server.output()}`,
        );
      }
    }

    const report: HarnessReport = {
      mode: options.mode,
      hardware: hardwareProfileOf(environment),
      profile: profile.name,
      environment,
      warnings: [
        ...environmentWarnings(environment),
        ...(options.mode === "baseline"
          ? baselineGate(environment, results, { scope, excluded })
          : []),
      ],
      datasetChecksum: setup.datasetChecksum,
      indexChecksum: setup.indexSnapshot.checksum,
      iterations: options.run?.iterations ?? 0,
      serverConfig: { apiRateLimitMax: BENCH_RATE_LIMIT_MAX },
      scope,
      coverage: { measured: results.map((r) => r.workload), excluded },
      results,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    if (options.outFile) {
      await writeFile(options.outFile, JSON.stringify(report, null, 2));
    }
    return report;
  } finally {
    await server?.stop();
    await setup.cleanup();
    await control.end().catch(() => {});
  }
}
