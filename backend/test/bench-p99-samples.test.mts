import { describe, expect, it } from "vitest";
import { MIN_SAMPLES_FOR_P99, judge } from "../bench/judge.mjs";
import { WORKLOADS } from "../bench/workloads.mjs";

/**
 * A tail percentile needs enough samples to be one.
 *
 * `percentileOf` is nearest-rank, so at 40 samples the p99 index is
 * `ceil(0.99 * 40) - 1 = 39`: the largest observation. Every p99 in the first
 * `target` run was the maximum wearing a percentile's name, and a single slow
 * request decided a PASS or a FAIL.
 */

const withP99 = WORKLOADS.find((w) => w.budget.p99Ms !== undefined)!;

const statsOf = (successCount: number, p99Ms: number, count = successCount) => ({
  count, successCount, p50Ms: 10, p95Ms: 20, p99Ms, maxMs: p99Ms,
  errorRate: 0, timeoutRate: 0, rps: 50, wireBytes: 10, uncompressedBytes: 10,
});

const noWork = { statements: 0, sharedBlocks: 0, tempBytes: 0, execMs: 0 };

describe("p99 needs enough samples", () => {
  it("does not judge a p99 from 40 samples, in either direction", () => {
    for (const p99 of [1, 10_000]) {
      const result = judge({
        workload: withP99,
        stats: statsOf(40, p99),
        dbWork: noWork,
        dbProbeAvailable: true,
      });
      expect(result.unmeasured.join(" "), `p99=${p99}`).toMatch(/p99: 40 successful samples/);
      // Neither a pass nor a breach: the number is not a percentile yet.
      expect(result.breaches.join(" "), `p99=${p99}`).not.toMatch(/p99/);
    }
  });

  it("counts successes, not attempts: 5,000 tries with 40 answers is not a p99", () => {
    // The gap this closes: `count` is attempts, so a route that failed almost
    // every request would have cleared a threshold on attempts alone while
    // having 40 latencies to place a percentile in.
    const result = judge({
      workload: withP99,
      stats: statsOf(40, 10_000, 5_000),
      dbWork: noWork,
      dbProbeAvailable: true,
    });
    expect(result.unmeasured.join(" ")).toMatch(/40 successful samples/);
    expect(result.breaches.join(" ")).not.toMatch(/p99/);
  });

  it("judges a p99 once there are enough samples to place it", () => {
    const result = judge({
      workload: withP99,
      stats: statsOf(MIN_SAMPLES_FOR_P99, withP99.budget.p99Ms! + 1),
      dbWork: noWork,
      dbProbeAvailable: true,
    });
    expect(result.unmeasured.join(" ")).not.toMatch(/p99/);
    expect(result.breaches.join(" ")).toMatch(/p99/);
  });
});
