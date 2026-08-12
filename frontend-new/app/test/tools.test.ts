import { describe, expect, it } from "vitest";
import { adaToLovelace, decodeCborHex, lovelaceToAda, splitAssetUnit } from "../src/lib/tools";

/**
 * The standalone developer utilities.
 *
 * Every reference explorer ships a few of these beside the explorer proper
 * (calldata decoder, unit converter, block-date converter). They are forms over
 * pure functions, so the functions are what get tested and the pages stay thin.
 */

describe("lovelace and ada", () => {
  it("converts lovelace to ada without losing precision", () => {
    expect(lovelaceToAda("1234567")).toBe("1.234567");
    expect(lovelaceToAda("1000000")).toBe("1");
    expect(lovelaceToAda("1")).toBe("0.000001");
  });

  it("handles amounts far beyond what a float could hold", () => {
    expect(lovelaceToAda("45000000000000000")).toBe("45000000000");
  });

  it("converts ada to lovelace", () => {
    expect(adaToLovelace("1.234567")).toBe("1234567");
    expect(adaToLovelace("1")).toBe("1000000");
    expect(adaToLovelace("0.000001")).toBe("1");
  });

  it("rejects more than six decimal places rather than rounding silently", () => {
    expect(() => adaToLovelace("1.1234567")).toThrow(/six decimal/i);
  });

  it("rejects a value that is not a number", () => {
    expect(() => adaToLovelace("abc")).toThrow();
    expect(() => lovelaceToAda("1.5")).toThrow();
  });
});

describe("asset units", () => {
  const policy = "ab".repeat(28);

  it("splits a unit into its policy and asset name", () => {
    expect(splitAssetUnit(policy + "4d4944")).toEqual({
      policyId: policy,
      assetName: "4d4944",
      readable: "MID",
    });
  });

  it("accepts a bare policy with no asset name", () => {
    expect(splitAssetUnit(policy)).toEqual({
      policyId: policy,
      assetName: "",
      readable: "",
    });
  });

  it("leaves an unreadable name as its bytes rather than guessing", () => {
    const result = splitAssetUnit(policy + "ff00");
    expect(result.assetName).toBe("ff00");
    expect(result.readable).toBe(null);
  });

  it("rejects a unit shorter than a policy id", () => {
    expect(() => splitAssetUnit("ab")).toThrow(/policy/i);
  });

  it("rejects a non-hex unit", () => {
    expect(() => splitAssetUnit("zz".repeat(28))).toThrow(/hex/i);
  });
});

describe("CBOR decoding", () => {
  it("decodes a small integer", () => {
    // 0x01 is CBOR for 1.
    expect(decodeCborHex("01")).toEqual({ ok: true, value: 1 });
  });

  it("decodes an array", () => {
    // 0x83 01 02 03 is [1, 2, 3].
    expect(decodeCborHex("83010203")).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it("renders bytes as hex rather than as an unreadable object", () => {
    // 0x42 aa bb is the two-byte string aabb.
    expect(decodeCborHex("42aabb")).toEqual({ ok: true, value: "0xaabb" });
  });

  it("reports a failure instead of throwing, so a paste cannot break the page", () => {
    const result = decodeCborHex("ff");
    expect(result.ok).toBe(false);
  });

  it("rejects input that is not hex", () => {
    const result = decodeCborHex("nothex");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/hex/i);
  });

  it("ignores whitespace and a 0x prefix, which is how bytes get pasted", () => {
    expect(decodeCborHex("0x83 01 02 03")).toEqual({ ok: true, value: [1, 2, 3] });
  });
});
