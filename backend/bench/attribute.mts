/**
 * Attributes each backend workload's statements by query.
 *
 *   pnpm bench:attribute [--requests 20] [--out attribution.json]
 *
 * One setup serves every workload. Requests bypass the response cache and use
 * distinct keys, so each one does the work the baseline counted rather than
 * being served from cache: the earlier throwaway probe reused a key and read
 * zero statements, which would have "proved" these routes touch no database.
 *
 * A diagnostic, not a gate. It records no verdict and produces no baseline.
 */
import { writeFile } from "node:fs/promises";
import { Client } from "pg";
import { attributeFrom, type Attribution } from "./attribution.mjs";
import { PROFILES } from "./profiles.mjs";
import { runRequests } from "./measure.mjs";
import { createDbProbe } from "./pgStats.mjs";
import { setupBench, startServer } from "./harness.mjs";
import { WORKLOADS } from "./workloads.mjs";

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? undefined : process.argv[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
};

const requests = Number(arg("requests", "20"));
const outFile = arg("out", "attribution.json");
const benchUrl = process.env.BENCH_POSTGRES_URL;
const liveIndexUrl = process.env.BENCH_SOURCE_INDEX_URL;
if (!benchUrl || !liveIndexUrl) {
  throw new Error("set BENCH_POSTGRES_URL and BENCH_SOURCE_INDEX_URL");
}

const control = new Client({ connectionString: benchUrl });
await control.connect();
const probe = await createDbProbe(control);
if (!probe.available) throw new Error("pg_stat_statements unavailable: nothing to attribute");

const setup = await setupBench({
  profile: PROFILES.target,
  benchUrl,
  liveIndexUrl,
  poolSize: requests,
});

let server: Awaited<ReturnType<typeof startServer>> | null = null;
const results: Attribution[] = [];
try {
  server = await startServer(setup, 43_412);
  const handle = server;
  // `warm` is excluded on purpose: it measures the cache, and a cache does no
  // database work, so there is nothing to attribute.
  const selected = WORKLOADS.filter((w) => w.origin === "backend" && w.cacheMode !== "warm");

  for (const workload of selected) {
    const urlFor = (i: number) =>
      `${handle.base}${workload.buildPath(setup.ids[i % setup.ids.length])}`;
    await probe.reset();
    await runRequests(urlFor, requests, 1, 30_000, { bypass: handle.bypassToken });
    const attribution = await attributeFrom(control, workload.name, requests);
    results.push(attribution);

    const c = attribution.byClass;
    console.log(
      `${workload.name.padEnd(28)} total=${attribution.total.toFixed(2)} ` +
        `txn-control=${c["transaction-control"].toFixed(2)} ` +
        `metadata=${c.metadata.toFixed(2)} ` +
        `route=${c["route-query"].toFixed(2)}`,
    );
  }
  await writeFile(outFile, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${outFile}`);
} finally {
  await server?.stop();
  await setup.cleanup();
  await control.end().catch(() => {});
}
