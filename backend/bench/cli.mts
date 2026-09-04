import { runHarness } from "./harness.mjs";
import { PROFILES } from "./profiles.mjs";

/**
 * Runs the workload catalogue and writes a JSON report.
 *
 *   node --experimental-strip-types bench/cli.mts \
 *     --profile target --mode baseline --out baseline.json
 *
 * `--mode smoke` proves the harness works. `--mode baseline` is the
 * measurement of record and applies `baselineGate`, which refuses a machine
 * with under 30 GB free, refuses to certify concurrency on two cores, and
 * refuses any run with an unmeasured budget. A smoke run's numbers are not
 * baselines and the report says which it was.
 *
 * Requires:
 *   BENCH_POSTGRES_URL       the dedicated benchmark server
 *   BENCH_SOURCE_INDEX_URL   the LIVE explorer index, read-only. Not
 *                            INDEXER_POSTGRES_URL, which the test setup
 *                            overrides to the empty `_test` database.
 */

const arg = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return value;
};

const profileName = arg("profile", "small") as keyof typeof PROFILES;
if (!(profileName in PROFILES)) {
  throw new Error(`unknown profile: ${profileName}`);
}
const mode = arg("mode", "smoke");
if (mode !== "smoke" && mode !== "baseline") {
  throw new Error(`mode must be smoke or baseline, got ${mode}`);
}

const benchUrl = process.env.BENCH_POSTGRES_URL;
const liveIndexUrl = process.env.BENCH_SOURCE_INDEX_URL;
if (!benchUrl || !liveIndexUrl) {
  throw new Error(
    "set BENCH_POSTGRES_URL and BENCH_SOURCE_INDEX_URL; see the note above on " +
      "why the index source is named separately",
  );
}

const report = await runHarness({
  profileName,
  benchUrl,
  liveIndexUrl,
  port: Number(arg("port", "43200")),
  mode,
  outFile: arg("out", `bench-${mode}-${profileName}.json`),
  run: { iterations: Number(arg("iterations", "40")) },
});

for (const warning of report.warnings) {
  console.error(`warning: ${warning}`);
}
for (const result of report.results) {
  const detail = result.breaches[0] ?? result.unmeasured[0] ?? "";
  console.log(
    `${result.workload.padEnd(28)} ${result.verdict.padEnd(11)} ` +
      `p95=${result.stats.p95Ms.toFixed(0)}ms ${detail}`,
  );
}

// A baseline run with blocking reasons is not a baseline. Exit non-zero so a
// caller cannot record it as one by ignoring the text above.
if (mode === "baseline" && report.warnings.length > 0) {
  console.error("\nNOT A BASELINE: the conditions above were not met.");
  process.exit(2);
}
