import { runHarness } from "./harness.mjs";
import { PROFILES } from "./profiles.mjs";
import { WORKLOADS } from "./workloads.mjs";

/**
 * Runs the workload catalogue and writes a JSON report.
 *
 *   node --experimental-strip-types bench/cli.mts \
 *     --profile target --mode baseline --out baseline.json
 *
 * `--mode smoke` proves the harness works. `--mode baseline` is the
 * measurement of record and applies `baselineGate`, which refuses a machine
 * with under 30 GB free and refuses any run with an unmeasured budget. Core
 * count does not block: two cores is the accepted minimum supported runtime
 * profile, and the report stamps `hardware` so a number is read as that
 * profile rather than as universal production hardware. A smoke run's numbers
 * are not baselines and the report says which it was.
 *
 * `--only <workload>` runs one row of the catalogue. A subset is a diagnostic
 * and `baselineGate` refuses to certify it, which is why the per-row commands
 * in `docs/performance-budgets.md` use `--mode smoke`.
 *
 * `--with-frontend` also builds the production frontend, starts it against the
 * backend under test, and measures the routes the frontend serves itself. A
 * baseline taken with it has scope `full` and must account for all of them.
 *
 * Requires:
 *   BENCH_POSTGRES_URL       the dedicated benchmark server, which this run
 *                            creates and drops databases on
 *   BENCH_SOURCE_NODE_URL    a Midgard node database, read only. Its settled
 *                            header hashes are copied into the generated
 *                            dataset so a settled block carries a hash a node
 *                            really committed. Nothing is measured against it
 *                            and nothing writes to it.
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

const only = process.argv.indexOf("--only");
const onlyWorkload = only === -1 ? undefined : process.argv[only + 1];
if (onlyWorkload !== undefined && !WORKLOADS.some((w) => w.name === onlyWorkload)) {
  throw new Error(`unknown workload: ${onlyWorkload}`);
}

const benchUrl = process.env.BENCH_POSTGRES_URL;
const sourceNodeUrl = process.env.BENCH_SOURCE_NODE_URL;
if (!benchUrl || !sourceNodeUrl) {
  throw new Error(
    "set BENCH_POSTGRES_URL and BENCH_SOURCE_NODE_URL; see the note above on " +
      "what each one is for",
  );
}

const report = await runHarness({
  profileName,
  only: onlyWorkload ? [onlyWorkload] : undefined,
  benchUrl,
  sourceNodeUrl,
  port: Number(arg("port", "43200")),
  mode,
  outFile: arg("out", `bench-${mode}-${profileName}.json`),
  run: { iterations: Number(arg("iterations", "40")) },
  withFrontend: process.argv.includes("--with-frontend"),
  // One quoted argument, so a flag's own leading dashes are not read as a CLI option.
  serverNodeFlags: process.argv.includes("--server-node-flags")
    ? (process.argv[process.argv.indexOf("--server-node-flags") + 1] ?? "")
        .split(/\s+/)
        .filter((flag) => flag.length > 0)
    : undefined,
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
