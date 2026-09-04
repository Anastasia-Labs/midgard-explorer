import type { Stats } from "./measure.mjs";
import type { DbWork } from "./pgStats.mjs";
import type { Workload } from "./workloads.mjs";

/**
 * Turns a measurement into a verdict.
 *
 * The rule that matters most: a budget whose instrument was unavailable is
 * `UNMEASURED`, never `PASS`. `pg_stat_statements` reports zero when it is not
 * installed, and zero satisfies "at most four statements" perfectly. That is
 * the most convincing false green available here, so it is refused explicitly
 * rather than left to the arithmetic.
 *
 * The second: a warm-cache run may not settle a database budget. Every `/api/`
 * route carries a five-second response cache, so a repeated path measures the
 * cache; a statement count taken from it describes the cache's zero work.
 *
 * The third: a tail percentile needs enough samples to be a percentile. The
 * percentile is nearest-rank, so at 40 samples `ceil(0.99 * 40) - 1` is index
 * 39, the largest observation. Every "p99" in the first `target` run was the
 * maximum wearing a percentile's name, and a single slow request decided it.
 * The count that matters is successful responses, not attempts: a route that
 * failed 900 of 1,000 requests has 100 latencies, however many it issued.
 */

export type Verdict = "PASS" | "FAIL" | "UNMEASURED";

export type Judgement = {
  workload: string;
  verdict: Verdict;
  /** Every budget the run breached, named with its measured and allowed value. */
  breaches: string[];
  /** Budgets that could not be evaluated, with the reason. */
  unmeasured: string[];
  stats: Stats;
  dbWork: DbWork;
};

/**
 * Successful samples required before a p99 verdict is recorded.
 *
 * At 1,000 the nearest-rank p99 is index `ceil(0.99 * 1000) - 1 = 989`, the
 * 11th-largest observation, so no single outlier can set it. Below this the
 * budget is `UNMEASURED`: not a pass, and not a failure either.
 */
export const MIN_SAMPLES_FOR_P99 = 1_000;

export type JudgeInput = {
  workload: Workload;
  stats: Stats;
  dbWork: DbWork;
  /** False when `pg_stat_statements` is absent. Every database budget is then unmeasured. */
  dbProbeAvailable: boolean;
};

export function judge(input: JudgeInput): Judgement {
  const { workload, stats, dbWork, dbProbeAvailable } = input;
  const budget = workload.budget;
  const breaches: string[] = [];
  const unmeasured: string[] = [];

  const check = (
    name: string,
    measured: number,
    limit: number | undefined,
    unit: string,
  ) => {
    if (limit === undefined) return;
    if (measured > limit) {
      breaches.push(`${name} ${format(measured, unit)} over ${format(limit, unit)}`);
    }
  };

  check("p95", stats.p95Ms, budget.p95Ms, "ms");
  if (budget.p99Ms !== undefined) {
    if (stats.successCount < MIN_SAMPLES_FOR_P99) {
      unmeasured.push(
        `p99: ${stats.successCount} successful samples is under ` +
          `${MIN_SAMPLES_FOR_P99}, so the nearest-rank p99 rests on too few ` +
          `observations to be a percentile`,
      );
    } else {
      check("p99", stats.p99Ms, budget.p99Ms, "ms");
    }
  }
  check("error rate", stats.errorRate, budget.maxErrorRate, "rate");
  check("timeout rate", stats.timeoutRate, budget.maxTimeoutRate, "rate");
  check("wire bytes", stats.wireBytes, budget.maxWireBytes, "bytes");
  check("identity bytes", stats.uncompressedBytes, budget.maxUncompressedBytes, "bytes");

  if (budget.minRps !== undefined && stats.rps < budget.minRps) {
    breaches.push(`throughput ${stats.rps.toFixed(1)}/s under ${budget.minRps}/s`);
  }

  const dbBudgets: [string, number | undefined, number, string][] = [
    ["statements", budget.maxDbStatements, dbWork.statements, "count"],
    ["shared blocks", budget.maxSharedBlocks, dbWork.sharedBlocks, "count"],
    ["temp bytes", budget.maxTempBytes, dbWork.tempBytes, "bytes"],
  ];
  for (const [name, limit, measured, unit] of dbBudgets) {
    if (limit === undefined) continue;
    if (!dbProbeAvailable) {
      // Zero from an absent probe satisfies any ceiling. Refused explicitly.
      unmeasured.push(`${name}: pg_stat_statements unavailable, so zero is not a pass`);
      continue;
    }
    if (workload.cacheMode === "warm") {
      // A warm run measures the cache, and the cache does no database work.
      unmeasured.push(`${name}: cacheMode is warm, so this measures the cache`);
      continue;
    }
    check(name, measured, limit, unit);
  }

  const verdict: Verdict =
    breaches.length > 0 ? "FAIL" : unmeasured.length > 0 ? "UNMEASURED" : "PASS";
  return { workload: workload.name, verdict, breaches, unmeasured, stats, dbWork };
}

function format(value: number, unit: string): string {
  if (unit === "rate") return `${(value * 100).toFixed(2)}%`;
  if (unit === "bytes") return `${(value / 1024).toFixed(1)} KB`;
  if (unit === "ms") return `${value.toFixed(1)} ms`;
  return String(Math.round(value));
}
