import { describe, expect, it } from "vitest";
import { GLOSSARY, glossaryText } from "../src/lib/glossary";

describe("shared explorer glossary", () => {
  it("gives every term a meaning and a consequence", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.label, key).not.toBe("");
      expect(entry.meaning, key).toMatch(/[.!?]$/);
      expect(entry.consequence, key).toMatch(/[.!?]$/);
      expect(entry.meaning.split(/\s+/).length, key).toBeGreaterThan(5);
      expect(entry.consequence.split(/\s+/).length, key).toBeGreaterThan(5);
    }
  });

  /** A tip is what a reader wants on hover: short enough to read at a glance. */
  it("keeps every one-line tip short", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      if (!("tip" in entry) || entry.tip === undefined) continue;
      expect(entry.tip, key).toMatch(/[.!?]$/);
      expect(entry.tip.split(/\s+/).length, key).toBeLessThanOrEqual(14);
    }
  });

  it("combines both parts for compact tooltip use", () => {
    expect(glossaryText("referenceInput")).toContain(GLOSSARY.referenceInput.meaning);
    expect(glossaryText("referenceInput")).toContain(GLOSSARY.referenceInput.consequence);
  });
});
