import { describe, expect, it } from "vitest";
import { PROFILES } from "../bench/profiles.mjs";
import { percentile, quantileAt, rng, sampleCount } from "../bench/random.mjs";

/**
 * The sampler is what turns a profile into data, so a defect here produces a
 * dataset that satisfies no invariant while looking plausible. Two properties
 * matter: it is reproducible (I10), and the data it draws actually has the
 * percentiles the profile states. A sampler that quietly produced a uniform
 * distribution would still fill every table.
 */

const SHAPE = { p50: 1, p95: 20, p99: 60, max: 200 };

describe("rng", () => {
  it("I10: the same seed produces the same sequence", () => {
    const a = Array.from({ length: 64 }, rng(7));
    const b = Array.from({ length: 64 }, rng(7));
    expect(a).toEqual(b);
  });

  it("different seeds produce different sequences", () => {
    const a = Array.from({ length: 64 }, rng(7));
    const b = Array.from({ length: 64 }, rng(8));
    expect(a).not.toEqual(b);
  });

  it("stays inside [0, 1)", () => {
    const next = rng(3);
    for (let i = 0; i < 10_000; i += 1) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("quantileAt", () => {
  it("returns the stated value at each breakpoint", () => {
    expect(quantileAt(SHAPE, 0.5)).toBeCloseTo(SHAPE.p50, 6);
    expect(quantileAt(SHAPE, 0.95)).toBeCloseTo(SHAPE.p95, 6);
    expect(quantileAt(SHAPE, 0.99)).toBeCloseTo(SHAPE.p99, 6);
    expect(quantileAt(SHAPE, 1)).toBeCloseTo(SHAPE.max, 6);
  });

  it("is monotonic and bounded", () => {
    let previous = -Infinity;
    for (let q = 0; q <= 1; q += 0.001) {
      const v = quantileAt(SHAPE, q);
      expect(v).toBeGreaterThanOrEqual(previous);
      expect(v).toBeLessThanOrEqual(SHAPE.max);
      expect(v).toBeGreaterThanOrEqual(0);
      previous = v;
    }
  });
});

describe("sampleCount", () => {
  it("reproduces the percentiles the shape states", () => {
    const next = rng(11);
    const drawn = Array.from({ length: 40_000 }, () => sampleCount(next(), SHAPE));
    // Integer rounding means these land near, not on, the stated values.
    expect(percentile(drawn, 0.5)).toBeCloseTo(SHAPE.p50, -0.5);
    expect(Math.abs(percentile(drawn, 0.95) - SHAPE.p95)).toBeLessThanOrEqual(2);
    expect(Math.abs(percentile(drawn, 0.99) - SHAPE.p99)).toBeLessThanOrEqual(4);
    expect(Math.max(...drawn)).toBeLessThanOrEqual(SHAPE.max);
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(0);
  });

  it("holds the stated percentiles once an empty mass is carved out", () => {
    // A block is empty with probability emptyBlockRate, and the rest are drawn
    // from the shape above that mass. Done naively the two fight and the
    // resulting median is not the stated one.
    const { txsPerBlock, emptyBlockRate } = PROFILES.target;
    const next = rng(13);
    const drawn: number[] = [];
    for (let i = 0; i < 40_000; i += 1) {
      const u = next();
      drawn.push(u < emptyBlockRate ? 0 : sampleCount(u, txsPerBlock));
    }
    const empties = drawn.filter((n) => n === 0).length / drawn.length;
    // A tolerance, not a floor: 40,000 draws land near the rate, not on it.
    // The rounded low tail also contributes a few zeros of its own.
    expect(Math.abs(empties - emptyBlockRate)).toBeLessThan(0.02);
    expect(percentile(drawn, 0.5)).toBeCloseTo(txsPerBlock.p50, -0.5);
    expect(Math.abs(percentile(drawn, 0.99) - txsPerBlock.p99)).toBeLessThanOrEqual(6);
  });
});
