import { describe, expect, it } from "vitest";
import { IDENTICON_GRID, identiconFor } from "../src/lib/identicon";

/**
 * Phase 4.3.1: a generated mark beside every address.
 *
 * The point is recognition, not information: an address is 60-odd characters
 * that all look alike once truncated, and a mark derived from the whole string
 * gives a reader something to match on. That means the requirements are about
 * determinism and spread, and it means the mark must never be the only place a
 * fact appears.
 */

const A = "addr_test1vpqgspvmh6m2m5pwangvdg499srfzre2dd96qq9tnqvtvtqz0mzgz";
const B = "addr_test1g9pqgspvmh6m2m5pwangvdg499srfzre2dd96qq9tnqvtvpg8ex3qw";

describe("identicon", () => {
  it("is the same every time for the same address", () => {
    expect(identiconFor(A)).toEqual(identiconFor(A));
  });

  it("differs between addresses", () => {
    expect(identiconFor(A)).not.toEqual(identiconFor(B));
  });

  it("reads the whole address, not a truncated prefix", () => {
    // Two addresses sharing a long prefix must not collide, which is the exact
    // case the UI creates by truncating every address it shows.
    const prefix = "addr_test1qq" + "0".repeat(40);
    expect(identiconFor(`${prefix}aaaa`)).not.toEqual(identiconFor(`${prefix}bbbb`));
  });

  it("fills a square grid", () => {
    expect(identiconFor(A).cells).toHaveLength(IDENTICON_GRID * IDENTICON_GRID);
  });

  it("is mirrored down the middle, so it reads as a mark rather than as noise", () => {
    const { cells } = identiconFor(A);
    for (let y = 0; y < IDENTICON_GRID; y += 1) {
      for (let x = 0; x < IDENTICON_GRID; x += 1) {
        const mirrored = IDENTICON_GRID - 1 - x;
        expect(cells[y * IDENTICON_GRID + x]).toBe(cells[y * IDENTICON_GRID + mirrored]);
      }
    }
  });

  it("never comes out blank or solid, which would carry no identity at all", () => {
    // Sampled across many addresses rather than one, since a single lucky seed
    // proves nothing about the generator.
    for (let i = 0; i < 500; i += 1) {
      const { cells } = identiconFor(`addr_test_${i}`);
      const on = cells.filter(Boolean).length;
      expect(on).toBeGreaterThan(0);
      expect(on).toBeLessThan(cells.length);
    }
  });

  it("spreads hues across the wheel instead of clustering", () => {
    const hues = new Set<number>();
    for (let i = 0; i < 200; i += 1) hues.add(Math.floor(identiconFor(`addr_${i}`).hue / 30));
    // Twelve 30-degree buckets exist; a generator worth having reaches most.
    expect(hues.size).toBeGreaterThanOrEqual(10);
  });

  it("keeps both hues in range", () => {
    for (let i = 0; i < 200; i += 1) {
      const { hue, accentHue } = identiconFor(`addr_${i}`);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(accentHue).toBeGreaterThanOrEqual(0);
      expect(accentHue).toBeLessThan(360);
    }
  });

  it("handles an empty seed rather than throwing on one", () => {
    expect(() => identiconFor("")).not.toThrow();
  });
});
