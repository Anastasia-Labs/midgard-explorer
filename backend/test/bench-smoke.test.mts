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
// BENCH_SOURCE_INDEX_URL, not INDEXER_POSTGRES_URL: the latter is overridden
// to the `_test` database by test/setup-indexer-db.mts, so the harness would
// clone an empty index and every real-data workload would measure nothing.
const INDEX_URL = process.env.BENCH_SOURCE_INDEX_URL;
const enabled = process.env.BENCH_SMOKE === "1" && BENCH_URL && INDEX_URL;
const smoke = enabled ? describe : describe.skip;

smoke("harness smoke run", () => {
  it("sets up, serves, measures and serialises", async () => {
    const report = await runHarness({
      profileName: "small",
      benchUrl: BENCH_URL!,
      liveIndexUrl: INDEX_URL!,
      port: 43_117,
      mode: "smoke",
      // A handful of the catalogue, one per cache mode, so every path through
      // runWorkload is exercised without a long run.
      only: ["blocks-list-page-1", "block-detail", "metrics", "metrics-cached"],
      run: { iterations: 8, timeoutMs: 20_000 },
    });

    expect(report.mode).toBe("smoke");
    expect(report.profile).toBe("small");
    expect(report.results.length).toBe(4);

    // Every workload actually reached the server and got answers.
    for (const result of report.results) {
      expect(result.stats.count, result.workload).toBe(8);
      expect(result.stats.errorRate, result.workload).toBe(0);
      expect(result.stats.timeoutRate, result.workload).toBe(0);
      expect(result.stats.p95Ms, result.workload).toBeGreaterThan(0);
    }

    // The dataset and the index snapshot are both identified, so a later run
    // can say whether it measured the same data.
    expect(report.datasetChecksum.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(report.datasetChecksum.rows).toBeGreaterThan(0);
    expect(report.indexChecksum.rows).toBeGreaterThan(0);

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

  it("refuses to certify this machine as a baseline", async () => {
    const { baselineGate } = await import("../bench/harness.mjs");
    const { captureEnvironment } = await import("../bench/environment.mjs");
    const { Client } = await import("pg");
    const client = new Client({ connectionString: BENCH_URL! });
    await client.connect();
    try {
      const environment = await captureEnvironment(client);
      const blocking = baselineGate(environment, []);
      // Two cores and a full disk: both must be named.
      expect(blocking.length).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  }, 60_000);
});
