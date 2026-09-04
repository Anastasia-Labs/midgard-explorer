import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { captureEnvironment, environmentWarnings } from "../bench/environment.mjs";

/**
 * The environment report exists so a number can be compared with a later one.
 * The warnings exist so a number taken on a starved machine says so, instead of
 * being published as if the machine were healthy.
 */

const BENCH_URL = process.env.BENCH_POSTGRES_URL;
const db = process.env.REQUIRE_DB === "1" && BENCH_URL ? describe : describe.skip;

describe("environmentWarnings", () => {
  const healthy = {
    postgresVersion: "PostgreSQL 17",
    settings: { track_io_timing: "on" },
    cpuCount: 8,
    cpuModel: "test",
    totalMemoryBytes: 32 * 1024 ** 3,
    freeDiskBytes: 100 * 1024 ** 3,
    nodeVersion: "v24",
    gitCommit: "abc",
    capturedAt: new Date().toISOString(),
  };

  it("is silent on a healthy machine", () => {
    expect(environmentWarnings(healthy)).toEqual([]);
  });

  it("warns when the disk cannot hold temp files", () => {
    // The failure that motivated this: at 100% full, a temp-byte budget errors
    // rather than measures, and the timing describes a starved filesystem.
    const warnings = environmentWarnings({ ...healthy, freeDiskBytes: 900 * 1024 ** 2 });
    expect(warnings.join(" ")).toMatch(/free/);
  });

  it("warns that a two-core box cannot measure a saturation workload", () => {
    const warnings = environmentWarnings({ ...healthy, cpuCount: 2 });
    expect(warnings.join(" ")).toMatch(/cores/);
  });

  it("warns when I/O timing is off", () => {
    const warnings = environmentWarnings({
      ...healthy,
      settings: { track_io_timing: "off" },
    });
    expect(warnings.join(" ")).toMatch(/track_io_timing/);
  });
});

db("captureEnvironment", () => {
  it("records the settings that change a plan", async () => {
    const client = new Client({ connectionString: BENCH_URL });
    await client.connect();
    try {
      const report = await captureEnvironment(client);
      expect(report.postgresVersion).toMatch(/PostgreSQL/);
      // Without these a later baseline cannot be compared with this one.
      expect(report.settings.work_mem).toBeDefined();
      expect(report.settings.shared_buffers).toBeDefined();
      expect(report.settings.effective_cache_size).toBeDefined();
      expect(report.cpuCount).toBeGreaterThan(0);
      expect(report.totalMemoryBytes).toBeGreaterThan(0);
      expect(report.nodeVersion).toMatch(/^v\d+/);
      expect(report.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await client.end();
    }
  }, 60_000);
});
