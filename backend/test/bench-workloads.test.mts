import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { ENDPOINTS } from "../src/server/catalogue.js";
import { WORKLOADS, type SeededIds } from "../bench/workloads.mjs";

/**
 * The workload catalogue is the contract between the budget register and the
 * harness. These assertions exist because each one corresponds to a defect that
 * would silently produce a meaningless benchmark rather than a failure:
 *
 *   - a hand-written path 404s, and a 404 is fast;
 *   - a hash of the wrong width fails `isHash28` before a query runs;
 *   - a warm-cache reading measures the response cache, not the database;
 *   - a budget with no register row is never reported on.
 */

const IDS: SeededIds = {
  blockHash: "ab".repeat(28),
  txId: "cd".repeat(32),
  address: "addr_test1qtest",
  page: 1,
};

const served = new Set(ENDPOINTS.map((e: { path: string }) => e.path));

describe("WORKLOADS", () => {
  it("names a catalogue template rather than a concrete path", () => {
    for (const w of WORKLOADS) {
      if (w.origin !== "backend") continue;
      expect(served.has(w.template), `${w.name} -> ${w.template}`).toBe(true);
    }
  });

  it("builds a concrete path that matches its own template", () => {
    for (const w of WORKLOADS) {
      if (w.origin !== "backend") continue;
      const concrete = w.buildPath(IDS).split("?")[0];
      const pattern = new RegExp(
        `^${w.template.replace(/:(\w+)/g, "[^/]+")}$`,
      );
      expect(concrete, `${w.name}`).toMatch(pattern);
    }
  });

  it("uses a 56-character header hash, matching isHash28", () => {
    for (const w of WORKLOADS) {
      const match = w.buildPath(IDS).match(/header_hash=([0-9a-f]+)/);
      if (match) expect(match[1], w.name).toHaveLength(56);
    }
  });

  it("gives every workload a unique name, an explorer owner and a positive p95", () => {
    const names = WORKLOADS.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
    for (const w of WORKLOADS) {
      expect(w.owner, w.name).toBe("explorer");
      expect(w.budget.p95Ms, w.name).toBeGreaterThan(0);
      expect(w.budget.maxErrorRate, w.name).toBeGreaterThanOrEqual(0);
    }
  });

  it("never rests a database budget on a warm-cache reading", () => {
    for (const w of WORKLOADS) {
      const readsDb =
        w.budget.maxDbStatements !== undefined ||
        w.budget.maxSharedBlocks !== undefined ||
        w.budget.maxTempBytes !== undefined;
      if (readsDb) expect(w.cacheMode, w.name).not.toBe("warm");
    }
  });

  it("covers all three cache modes", () => {
    const modes = new Set(WORKLOADS.map((w) => w.cacheMode));
    expect(modes.has("cold")).toBe(true);
    expect(modes.has("warm")).toBe(true);
    expect(modes.has("unique-key")).toBe(true);
  });

  it("declares an upstream dependency only where one exists", () => {
    for (const w of WORKLOADS) {
      if (w.dependency !== null) expect(w.dependency, w.name).toMatch(/^UR-\d+$/);
    }
  });

  it("gives every workload a p99 above its p95", () => {
    for (const w of WORKLOADS) {
      expect(w.budget.p99Ms, w.name).toBeGreaterThanOrEqual(w.budget.p95Ms);
    }
  });

  it("budgets timeouts separately from errors", () => {
    for (const w of WORKLOADS) {
      expect(w.budget.maxTimeoutRate, w.name).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every concurrent workload a throughput floor", () => {
    for (const w of WORKLOADS) {
      if (w.concurrency > 1) expect(w.budget.minRps, w.name).toBeGreaterThan(0);
    }
  });

  it("pairs every wire budget with an uncompressed budget, so a ratio is computable", () => {
    for (const w of WORKLOADS) {
      if (w.budget.maxWireBytes !== undefined) {
        expect(w.budget.maxUncompressedBytes, w.name).toBeGreaterThan(0);
      }
    }
  });

  it("never budgets buffer READS alone, which a shared-buffer hit would pass", () => {
    // The type already forbids it. This asserts the runtime shape too, so a
    // widened or hand-edited entry cannot reintroduce a read-only budget: a
    // full scan served from shared buffers reports zero reads and would pass.
    for (const w of WORKLOADS) {
      const keys = Object.keys(w.budget as Record<string, unknown>);
      expect(keys, w.name).not.toContain("maxBufferReads");
      expect(keys, w.name).not.toContain("maxSharedReads");
    }
  });

  it("names every workload in the budget register", async () => {
    const register = await readFile("../docs/performance-budgets.md", "utf8");
    for (const w of WORKLOADS) {
      expect(register, `${w.name} missing from the register`).toContain(w.name);
    }
  });

  it("states each workload's p95 and p99 in the register, so prose cannot drift", async () => {
    const register = await readFile("../docs/performance-budgets.md", "utf8");
    const fmt = (n: number) => n.toLocaleString("en-US");
    for (const w of WORKLOADS) {
      const row = register
        .split("\n")
        .find((line) => line.includes(`\`${w.name}\``) && line.startsWith("|"));
      expect(row, `${w.name} has no register row`).toBeDefined();
      expect(row, `${w.name} p95`).toContain(`p95 ${fmt(w.budget.p95Ms)} ms`);
      expect(row, `${w.name} p99`).toContain(`p99 ${fmt(w.budget.p99Ms)} ms`);
    }
  });

  it("labels every register row with a data provenance", async () => {
    // A number measured on generated data is evidence about a change, not about
    // production. Without the label a reader cannot tell which they are holding.
    const register = await readFile("../docs/performance-budgets.md", "utf8");
    for (const w of WORKLOADS) {
      const row = register
        .split("\n")
        .find((line) => line.includes(`\`${w.name}\``) && line.startsWith("|"));
      expect(row, `${w.name} has no register row`).toBeDefined();
      expect(
        /`(real|real\+extended|generated)`/.test(row as string),
        `${w.name} has no provenance`,
      ).toBe(true);
    }
  });

  it("carries no stale pre-approval language", async () => {
    // The targets were approved on 2026-09-04. Text describing them as
    // proposals, or as awaiting approval, contradicts the committed state and
    // is how a reader ends up trusting the wrong lifecycle.
    const register = await readFile("../docs/performance-budgets.md", "utf8");
    const catalogue = await readFile("bench/workloads.mts", "utf8");
    for (const stale of [
      "AWAITING OWNER APPROVAL",
      "Target (proposed)",
      "Nothing in this register is approved",
      "awaiting owner approval",
      "PROPOSALS",
      "unapproved target",
    ]) {
      expect(register, `register: ${stale}`).not.toContain(stale);
      expect(catalogue, `catalogue: ${stale}`).not.toContain(stale);
    }
  });

  it("keeps every register row in a declared lifecycle state", async () => {
    const register = await readFile("../docs/performance-budgets.md", "utf8");
    expect(register).toContain(
      "ALL TARGETS APPROVED EXCEPT BACKEND SUITE WALL TIME",
    );
    expect(register).toContain("| `PENDING APPROVAL` |");
    // A DISCOVERY row is excluded from the 10/10 criterion during BASELINES
    // only. Left permanently unmeasured it would sit inside a 10/10 claim.
    expect(register).toContain("during `BASELINES` only");
    // DISCOVERY rows have no target and are excluded from the 10/10 criterion.
    expect(register).toContain("DISCOVERY");
    // A sample too small to resolve its target reports INSUFFICIENT, not PASS.
    expect(register).toContain("INSUFFICIENT");
  });
});
