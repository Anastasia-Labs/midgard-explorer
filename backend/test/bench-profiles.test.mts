import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PROFILES, type Profile } from "../bench/profiles.mjs";

/**
 * The profiles encode the ten invariants in `docs/dataset-profiles.md`. Each
 * assertion here corresponds to one, because a generator that silently violates
 * an invariant produces a benchmark that measures the wrong thing and still
 * reports a number.
 */

const all = Object.values(PROFILES) as Profile[];

describe("PROFILES", () => {
  it("declares the three profiles the spec names", () => {
    expect(Object.keys(PROFILES).sort()).toEqual(["small", "stress", "target"]);
  });

  it("I1: header hashes are 28 bytes, matching isHash28", () => {
    for (const p of all) expect(p.headerHashBytes, p.name).toBe(28);
  });

  it("I2: Merkle roots are 64 hex characters, 32 bytes, in a text column", () => {
    for (const p of all) expect(p.rootHexLength, p.name).toBe(64);
  });

  it("I4: target and stress collide timestamps so the tiebreak is observable", () => {
    // BYTEA-ORDERING's correctness test needs blocks that share a
    // block_end_time; without collisions the tiebreak is never exercised.
    expect(PROFILES.target.timestampCollisionRate).toBeGreaterThan(0);
    expect(PROFILES.stress.timestampCollisionRate).toBeGreaterThan(0);
    expect(PROFILES.small.timestampCollisionRate).toBe(0);
  });

  it("carries the approved empty-block rates, small mirroring and target challenging", () => {
    // small reproduces observed reality (7 of 9 live blocks are empty);
    // target is deliberately harsher, approved 2026-09-04 as a challenge.
    expect(PROFILES.small.emptyBlockRate).toBeCloseTo(0.78, 2);
    expect(PROFILES.target.emptyBlockRate).toBeCloseTo(0.3, 2);
  });

  it("gives target enough blocks for the deepest paginated workload", () => {
    // blocks-list-page-deep requests page 100. At 25 rows per page that needs
    // 2,500 rows to exist, or the budget measures an empty page.
    expect(PROFILES.target.blocks).toBeGreaterThanOrEqual(2_500);
  });

  it("sizes target's ledger to the scan bound it is meant to exercise", () => {
    expect(PROFILES.target.ledgerUtxos).toBe(20_000);
  });

  it("I10: profiles are deterministic, carrying an explicit seed", () => {
    for (const p of all) expect(typeof p.seed, p.name).toBe("number");
    // Distinct seeds, so two profiles cannot accidentally produce the same data.
    const seeds = all.map((p) => p.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("keeps the status mix a distribution that sums to one", () => {
    for (const p of all) {
      const total =
        p.statusMix.finalized + p.statusMix.pending + p.statusMix.failed;
      expect(total, p.name).toBeCloseTo(1, 5);
    }
  });

  it("orders the profiles strictly by size", () => {
    expect(PROFILES.small.blocks).toBeLessThan(PROFILES.target.blocks);
    expect(PROFILES.target.blocks).toBeLessThan(PROFILES.stress.blocks);
  });

  it("marks every assumption-derived field as such, so no reader mistakes it for measurement", () => {
    for (const p of all) {
      expect(Array.isArray(p.assumptions), p.name).toBe(true);
      expect(p.assumptions.length, p.name).toBeGreaterThan(0);
    }
  });

  it("matches the numbers stated in the specification", async () => {
    const spec = await readFile("../docs/dataset-profiles.md", "utf8");
    expect(spec).toContain(`${PROFILES.target.blocks.toLocaleString("en-US")}`);
    expect(spec).toContain(`${PROFILES.stress.blocks.toLocaleString("en-US")}`);
    expect(spec).toContain("20,000");
  });
});
