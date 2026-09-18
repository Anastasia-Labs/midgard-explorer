import { describe, expect, it } from "vitest";
import { runHarness } from "../bench/harness.mjs";

/**
 * The harness, end to end, at `small`.
 *
 * A FUNCTIONAL smoke test, not a measurement. It proves seeding, cloning, id
 * resolution, dual-database routing, cache modes and serialization all work
 * together. The timings it produces are on a two-core machine with a small
 * dataset and must never be published as baselines; `baselineGate` is what
 * enforces that, and this asserts the gate refuses.
 */

const BENCH_URL = process.env.BENCH_POSTGRES_URL;
// A Midgard node database, for the real settled header hashes the generated
// dataset carries. Read only, and never the thing being measured.
const NODE_URL = process.env.BENCH_SOURCE_NODE_URL;
const enabled = process.env.BENCH_SMOKE === "1" && BENCH_URL && NODE_URL;
const smoke = enabled ? describe : describe.skip;

smoke("harness smoke run", () => {
  it("sets up, serves, measures and serialises", async () => {
    const report = await runHarness({
      profileName: "small",
      benchUrl: BENCH_URL!,
      sourceNodeUrl: NODE_URL!,
      port: 43_117,
      mode: "smoke",
      // A handful of the catalogue, one per cache mode, so every path through
      // runWorkload is exercised without a long run.
      only: ["blocks-list-page-1", "block-detail", "metrics", "metrics-cached"],
      // Above the server's default 120-per-minute allowance across these four
      // workloads (4 x 40 = 160). At 8 the smoke run stayed under the limit and
      // could not see that a real run exhausts it after three workloads and
      // measures 429s from then on. This is the cheapest place that reproduces
      // it end to end.
      run: { iterations: 40, timeoutMs: 20_000 },
    });

    expect(report.mode).toBe("smoke");
    expect(report.profile).toBe("small");
    expect(report.results.length).toBe(4);

    // Every workload actually reached the server and got answers.
    for (const result of report.results) {
      expect(result.stats.count, result.workload).toBe(40);
      expect(result.stats.errorRate, result.workload).toBe(0);
      expect(result.stats.timeoutRate, result.workload).toBe(0);
      expect(result.stats.p95Ms, result.workload).toBeGreaterThan(0);
    }

    // The dataset and the index snapshot are both identified, so a later run
    // can say whether it measured the same data.
    expect(report.datasetChecksum.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(report.datasetChecksum.rows).toBeGreaterThan(0);
    expect(report.settledHashCount).toBeGreaterThan(0);
    expect(report.settledHashSource).not.toMatch(/:[^@/]*@/);

    // Cold workloads bypassed both caches, so they did real database work.
    const cold = report.results.find((r) => r.workload === "blocks-list-page-1")!;
    expect(cold.dbWork.statements).toBeGreaterThan(0);

    // Cache modes actually differ. `metrics` is cold and bypasses both layers;
    // `metrics-cached` is warm and is served from the response cache, so it
    // must do far less database work. Equal figures would mean the bypass
    // header was ignored and every cold budget was measuring the cache.
    const coldMetrics = report.results.find((r) => r.workload === "metrics")!;
    const warmMetrics = report.results.find((r) => r.workload === "metrics-cached")!;
    expect(coldMetrics.dbWork.statements).toBeGreaterThan(
      warmMetrics.dbWork.statements,
    );
    // `metrics-cached` carries only latency budgets, so a PASS there is
    // legitimate. The refusal rule applies to database budgets, and
    // `bench-judge.test.mts` covers it directly.
    expect(warmMetrics.stats.p95Ms).toBeLessThan(coldMetrics.stats.p95Ms * 2);

    // The whole report round-trips as JSON, which is what makes it comparable.
    const parsed = JSON.parse(JSON.stringify(report));
    expect(parsed.results[0].workload).toBe(report.results[0].workload);
    expect(parsed.environment.gitCommit).toMatch(/^[0-9a-f]{40}$/);
  }, 600_000);

  it("judges this machine against the real gate, whatever the answer is", async () => {
    // This asserted that the gate refuses this machine, on two grounds that
    // have both since gone: the core count stopped blocking when two cores were
    // accepted as the minimum supported profile, and the disk was freed past
    // the 30 GB threshold. Asserting a refusal would now fail for the good
    // reason that the machine became eligible, so it asserts the contract
    // instead: whatever the gate says, it must be about disk headroom or a
    // workload that measured nothing, never about the core count.
    const { baselineGate } = await import("../bench/harness.mjs");
    const { captureEnvironment } = await import("../bench/environment.mjs");
    const { Client } = await import("pg");
    const client = new Client({ connectionString: BENCH_URL! });
    await client.connect();
    try {
      const environment = await captureEnvironment(client);
      expect(baselineGate(environment, []).join(" ")).not.toMatch(/core/i);

      // And it still refuses on the conditions that do disqualify a run.
      const starved = { ...environment, freeDiskBytes: 1024 ** 3 };
      expect(baselineGate(starved, []).join(" ")).toMatch(/30 GB free/);
    } finally {
      await client.end();
    }
  }, 60_000);
});
