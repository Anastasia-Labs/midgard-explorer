import { describe, expect, it } from "vitest";
import { judge } from "../bench/judge.mjs";
import type { Stats } from "../bench/measure.mjs";
import type { Workload } from "../bench/workloads.mjs";

/**
 * The verdict is where a false green would live, so the cases below are the
 * ways a run could look like a pass while measuring nothing.
 */

const stats = (over: Partial<Stats> = {}): Stats => ({
  // Above MIN_SAMPLES_FOR_P99: below it a p99 budget is UNMEASURED, because a
  // nearest-rank p99 over a hundred samples is the second-largest observation
  // rather than a percentile. These cases are about the budgets, not that rule.
  count: 1_000,
  successCount: 1_000,
  p50Ms: 50,
  p95Ms: 100,
  p99Ms: 150,
  maxMs: 200,
  errorRate: 0,
  timeoutRate: 0,
  rps: 50,
  wireBytes: 1_000,
  uncompressedBytes: 4_000,
  ...over,
});

const workload = (over: Partial<Workload> = {}): Workload => ({
  name: "probe",
  origin: "backend",
  template: "/api/blocks/:page",
  buildPath: () => "/api/blocks/1",
  cacheMode: "cold",
  concurrency: 1,
  profile: "target",
  owner: "explorer",
  dependency: null,
  budget: {
    p95Ms: 200,
    p99Ms: 400,
    maxErrorRate: 0,
    maxTimeoutRate: 0,
    maxDbStatements: 4,
    maxTempBytes: 0,
  },
  ...over,
});

// The preamble is present and deliberately not what the budget counts:
// `statements` is the raw total, `routeStatements` is what `judge` compares.
const work = {
  statements: 6,
  routeStatements: 3,
  transactionControl: 3,
  metadataStatements: 0,
  sharedBlocks: 500,
  tempBytes: 0,
  execMs: 20,
};

describe("judge", () => {
  it("passes a run inside every budget", () => {
    const result = judge({ workload: workload(), stats: stats(), dbWork: work, dbProbeAvailable: true });
    expect(result.verdict).toBe("PASS");
    expect(result.breaches).toEqual([]);
  });

  it("refuses to pass a database budget when the probe is unavailable", () => {
    // pg_stat_statements reports zero when absent, and zero satisfies "at most
    // four statements". This is the false green the whole harness must not
    // produce.
    const result = judge({
      workload: workload(),
      stats: stats(),
      dbWork: { statements: 0, routeStatements: 0, transactionControl: 0, metadataStatements: 0, sharedBlocks: 0, tempBytes: 0, execMs: 0 },
      dbProbeAvailable: false,
    });
    expect(result.verdict).toBe("UNMEASURED");
    expect(result.unmeasured.join(" ")).toMatch(/unavailable/);
    expect(result.breaches).toEqual([]);
  });

  it("refuses to settle a database budget from a warm-cache run", () => {
    const result = judge({
      workload: workload({ cacheMode: "warm" }),
      stats: stats(),
      dbWork: { statements: 0, routeStatements: 0, transactionControl: 0, metadataStatements: 0, sharedBlocks: 0, tempBytes: 0, execMs: 0 },
      dbProbeAvailable: true,
    });
    expect(result.verdict).toBe("UNMEASURED");
    expect(result.unmeasured.join(" ")).toMatch(/warm/);
  });

  it("fails on latency, naming the measured and allowed values", () => {
    const result = judge({
      workload: workload(),
      stats: stats({ p95Ms: 500 }),
      dbWork: work,
      dbProbeAvailable: true,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.breaches[0]).toMatch(/p95 500.0 ms over 200.0 ms/);
  });

  it("counts a timeout separately from an error", () => {
    const result = judge({
      workload: workload(),
      stats: stats({ timeoutRate: 0.05 }),
      dbWork: work,
      dbProbeAvailable: true,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.breaches.join(" ")).toMatch(/timeout rate/);
    expect(result.breaches.join(" ")).not.toMatch(/error rate/);
  });

  it("fails a throughput floor that is not met", () => {
    const result = judge({
      workload: workload({ budget: { ...workload().budget, minRps: 100 } }),
      stats: stats({ rps: 20 }),
      dbWork: work,
      dbProbeAvailable: true,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.breaches.join(" ")).toMatch(/throughput/);
  });

  it("fails temp bytes, which latency alone would hide", () => {
    // A sort spilling to disk does not show in latency until it is severe.
    const result = judge({
      workload: workload(),
      stats: stats(),
      dbWork: { ...work, tempBytes: 8192 },
      dbProbeAvailable: true,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.breaches.join(" ")).toMatch(/temp bytes/);
  });

  it("reports a breach even when something else is unmeasured", () => {
    const result = judge({
      workload: workload(),
      stats: stats({ p95Ms: 900 }),
      dbWork: work,
      dbProbeAvailable: false,
    });
    // A real failure outranks an unmeasured budget: the run did breach.
    expect(result.verdict).toBe("FAIL");
    expect(result.unmeasured.length).toBeGreaterThan(0);
  });
});

describe("the budget counts route queries, not the preamble", () => {
  /**
   * Ruled 2026-09-05. Every request pays BEGIN / SET TRANSACTION ISOLATION
   * LEVEL REPEATABLE READ / COMMIT, which is the snapshot consistency the
   * explorer depends on. Counting it made `asset-roster`'s budget of two
   * unreachable at any query count, and turned seven of eight measured
   * failures into a property of the preamble rather than of the route.
   */
  it("passes a route inside its budget however large the preamble is", () => {
    const result = judge({
      workload: workload(),
      stats: stats(),
      // asset-roster's real shape: 5 statements, of which 2 are the route's.
      dbWork: {
        statements: 5,
        routeStatements: 2,
        transactionControl: 3,
        metadataStatements: 0,
        sharedBlocks: 500,
        tempBytes: 0,
        execMs: 20,
      },
      dbProbeAvailable: true,
    });
    expect(result.breaches.join(" ")).not.toMatch(/statements/);
  });

  it("still fails a route whose own queries exceed the budget", () => {
    // block-detail: 19 total, 10 of them the route's, against a budget of 8.
    const result = judge({
      workload: workload({
        budget: { ...workload().budget, maxDbStatements: 8 },
      }),
      stats: stats(),
      dbWork: {
        statements: 19,
        routeStatements: 10,
        transactionControl: 6,
        metadataStatements: 3,
        sharedBlocks: 500,
        tempBytes: 0,
        execMs: 20,
      },
      dbProbeAvailable: true,
    });
    expect(result.breaches.join(" ")).toMatch(/route statements 10 over 8/);
  });
});
