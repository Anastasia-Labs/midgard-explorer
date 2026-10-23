import type { Shape } from "./profiles.mjs";

/**
 * Deterministic sampling for the shaped seed generator.
 *
 * Two jobs, both load-bearing for I10 (same profile, same bytes):
 *
 *   - a seeded generator, so a dataset can be rebuilt byte for byte from its
 *     profile alone rather than being archived;
 *   - an inverse-CDF sampler, so the data a profile describes actually has the
 *     percentiles the profile states.
 *
 * The second matters more than it looks. A generator drawing uniformly between
 * 0 and `max` fills every table and satisfies every foreign key, and the
 * resulting benchmark measures a workload nobody specified.
 */

/**
 * mulberry32. Small, fast, and adequate here: this seeds a benchmark, so what
 * is needed is reproducibility and a reasonable spread, not cryptographic
 * quality.
 */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The shape's quantile function, piecewise linear between its stated points.
 *
 * A `Shape` names four quantiles: p50, p95, p99 and the maximum. Everything
 * between them is interpolated, and everything below p50 runs down to zero.
 * Inverting it is what makes a uniform draw come out with the stated
 * percentiles by construction rather than by luck.
 */
export function quantileAt(shape: Shape, q: number): number {
  const clamped = Math.min(1, Math.max(0, q));
  if (clamped < 0.5) return lerp(0, shape.p50, clamped / 0.5);
  if (clamped < 0.95) return lerp(shape.p50, shape.p95, (clamped - 0.5) / 0.45);
  if (clamped < 0.99) return lerp(shape.p95, shape.p99, (clamped - 0.95) / 0.04);
  return lerp(shape.p99, shape.max, (clamped - 0.99) / 0.01);
}

/** A count drawn from `shape` for the uniform draw `u`. Never negative. */
export function sampleCount(u: number, shape: Shape): number {
  return Math.max(0, Math.round(quantileAt(shape, u)));
}

/** A byte length drawn from `shape`. Never below one: no zero-length payloads. */
export function sampleBytes(u: number, shape: Shape): number {
  return Math.max(1, Math.round(quantileAt(shape, u)));
}

/**
 * Picks one entry from `weights` for the uniform draw `u`.
 *
 * `weights` is a list of [value, share] pairs whose shares sum to one. Used for
 * the status split and the search-term mix.
 */
export function pick<T>(u: number, weights: readonly (readonly [T, number])[]): T {
  let acc = 0;
  for (const [value, share] of weights) {
    acc += share;
    if (u < acc) return value;
  }
  return weights[weights.length - 1][0];
}

/** The `q` quantile of `values`, by nearest rank. For asserting on a sample. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error("percentile of an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}
