import { describe, expect, it } from "vitest";
import { PATHS } from "../src/components/ui/base/icons";
import { GLOSSARY } from "../src/lib/glossary";
import { SEMANTIC_ICONS } from "../src/lib/semantic-icons";

describe("semantic Cardano icon registry", () => {
  it("covers every investigation concept named in the feedback", () => {
    for (const kind of [
      "utxo",
      "referenceInput",
      "paymentCredential",
      "stakeCredential",
      "datumHash",
      "datum",
      "script",
      "collateral",
      "mintBurn",
      "metadata",
      "consumedBy",
      "protocolEvent",
      "executionTrace",
    ]) {
      expect(SEMANTIC_ICONS, kind).toHaveProperty(kind);
    }
  });

  it("points every semantic concept at an existing glyph and explanation", () => {
    for (const [kind, semantic] of Object.entries(SEMANTIC_ICONS)) {
      expect(PATHS, kind).toHaveProperty(semantic.icon);
      expect(GLOSSARY, kind).toHaveProperty(semantic.term);
    }
  });

  it("keeps input, output, reference, and collateral glyphs distinct", () => {
    const icons = ["input", "output", "referenceInput", "collateral"].map(
      (kind) => SEMANTIC_ICONS[kind as keyof typeof SEMANTIC_ICONS].icon,
    );
    expect(new Set(icons).size).toBe(icons.length);
  });
});
