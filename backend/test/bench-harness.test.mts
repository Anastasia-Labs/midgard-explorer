import { describe, expect, it } from "vitest";
import { baselineGate, hardwareProfileOf } from "../bench/harness.mjs";
import type { EnvironmentReport } from "../bench/environment.mjs";
import type { Judgement } from "../bench/judge.mjs";

/**
 * The baseline gate.
 *
 * A smoke run proves the harness works; a baseline is the measurement of
 * record. The gate is what stops one being mistaken for the other, so these
 * assertions are about refusing to certify, not about running.
 */

const GB = 1024 ** 3;
const healthy: EnvironmentReport = {
  postgresVersion: "PostgreSQL 17",
  settings: { track_io_timing: "on" },
  cpuCount: 16,
  cpuModel: "test",
  totalMemoryBytes: 64 * GB,
  freeDiskBytes: 100 * GB,
  nodeVersion: "v24",
  gitCommit: "a".repeat(40),
  capturedAt: new Date().toISOString(),
};

const clean: Judgement[] = [
  {
    workload: "blocks-list-page-1",
    verdict: "PASS",
    breaches: [],
    unmeasured: [],
    stats: {
      count: 40, p50Ms: 10, p95Ms: 20, p99Ms: 30, maxMs: 40,
      errorRate: 0, timeoutRate: 0, rps: 50, wireBytes: 100, uncompressedBytes: 200,
    },
    dbWork: { statements: 3, sharedBlocks: 10, tempBytes: 0, execMs: 1 },
  },
];

describe("baselineGate", () => {
  it("permits a baseline on a healthy machine with fully measured results", () => {
    expect(baselineGate(healthy, clean)).toEqual([]);
  });

  it("refuses below 30 GB free, naming the headroom reason", () => {
    const blocking = baselineGate({ ...healthy, freeDiskBytes: 5.2 * GB }, clean);
    expect(blocking.join(" ")).toMatch(/30 GB free/);
    expect(blocking.join(" ")).toMatch(/5\.2 GB/);
  });

  it("permits a baseline on the accepted two-core minimum", () => {
    // Ruled 2026-09-04: two cores is the minimum supported runtime profile
    // (docs/resource-requirements.md:47), so runtime, database, payload and
    // concurrency budgets may be judged there. Scheduler pressure is part of
    // performance on the supported minimum, not a distortion of it.
    expect(baselineGate({ ...healthy, cpuCount: 2 }, clean)).toEqual([]);
  });

  it("stamps the hardware, so a result is qualified rather than universal", () => {
    expect(hardwareProfileOf({ ...healthy, cpuCount: 2 })).toBe(
      "existing-minimum-2-core",
    );
    expect(hardwareProfileOf({ ...healthy, cpuCount: 16 })).toBe("unclassified");
  });

  it("refuses when any workload had an unmeasured budget", () => {
    // An unmeasured budget in a baseline is the false green the harness exists
    // to prevent: nothing failed, and nothing was checked either.
    const blocking = baselineGate(healthy, [
      { ...clean[0], verdict: "UNMEASURED", unmeasured: ["statements: probe unavailable"] },
    ]);
    expect(blocking.join(" ")).toMatch(/unmeasured budgets/);
  });

  it("reports every blocking reason, not just the first", () => {
    const blocking = baselineGate({ ...healthy, freeDiskBytes: 1 * GB }, [
      { ...clean[0], verdict: "UNMEASURED", unmeasured: ["temp bytes: warm"] },
      { ...clean[0], workload: "metrics", verdict: "UNMEASURED", unmeasured: ["statements"] },
    ]);
    expect(blocking.length).toBe(3);
  });
});
