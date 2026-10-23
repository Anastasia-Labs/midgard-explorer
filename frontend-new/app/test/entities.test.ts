import { describe, expect, it } from "vitest";
import { ENTITIES, entityOf, type EntityKind } from "../src/lib/entities";
import { PATHS } from "../src/components/ui/icons";

/**
 * Phase 4.3.2: the record-type registry.
 *
 * One place that says what each record type is called, which glyph stands for
 * it, and which hue it takes. A registry rather than per-page choices, because
 * a type that is a cube on one page and a square on another teaches a reader
 * nothing.
 */

const kinds = Object.keys(ENTITIES) as EntityKind[];

describe("the record-type registry", () => {
  it("covers every type the meeting named", () => {
    for (const kind of [
      "transaction",
      "block",
      "address",
      "asset",
      "deposit",
      "withdrawal",
      "forcedTransaction",
    ]) {
      expect(kinds).toContain(kind);
    }
  });

  it("gives every type a word, so colour is never the only channel", () => {
    for (const kind of kinds) expect(ENTITIES[kind].label.length).toBeGreaterThan(0);
  });

  it("gives every type a glyph that actually exists in the icon set", () => {
    for (const kind of kinds) expect(PATHS).toHaveProperty(ENTITIES[kind].icon);
  });

  it("gives every type its own glyph, so the second channel discriminates", () => {
    const icons = kinds.map((k) => ENTITIES[k].icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("keeps hues far enough apart to be told apart", () => {
    const hues = kinds.map((k) => ENTITIES[k].hue).sort((a, b) => a - b);
    for (let i = 1; i < hues.length; i += 1) {
      expect(hues[i]! - hues[i - 1]!).toBeGreaterThanOrEqual(20);
    }
    expect(hues.at(-1)!).toBeLessThan(360);
    expect(hues[0]!).toBeGreaterThanOrEqual(0);
  });

  it("resolves a known kind", () => {
    expect(entityOf("block").label).toBe("Block");
  });

  it("falls back rather than throwing on a kind it has not been taught", () => {
    // Search candidates and status values both come from the backend, which is
    // free to grow. An unknown type must render as itself, not crash a page.
    const unknown = entityOf("something-new" as EntityKind);
    expect(unknown.label.length).toBeGreaterThan(0);
    expect(PATHS).toHaveProperty(unknown.icon);
  });
});
