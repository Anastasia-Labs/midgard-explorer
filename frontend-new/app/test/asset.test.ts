import { describe, expect, it } from "vitest";
import {
  assetFingerprint,
  assetLabel,
  decodeAssetName,
  formatQuantity,
  parseAssetUnit,
} from "../src/lib/asset";

describe("CIP-14 fingerprints", () => {
  /** The complete vector set from CIP-0014, transcribed from the specification
   * rather than recalled. These are the whole reason the fingerprint is worth
   * computing: an implementation that disagreed with the standard would name a
   * different asset from every other tool, which is worse than showing no
   * identifier at all. The last two swap the policy and name bytes, which is
   * exactly the mistake a concatenation order bug produces. */
  const P1 = "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373";
  const P2 = "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc37e";
  const P3 = "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209";

  it.each([
    [P1, "", "asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3"],
    [P2, "", "asset1nl0puwxmhas8fawxp8nx4e2q3wekg969n2auw3"],
    [P3, "", "asset1uyuxku60yqe57nusqzjx38aan3f2wq6s93f6ea"],
    [P1, "504154415445", "asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92"],
    [P3, "504154415445", "asset1hv4p5tv2a837mzqrst04d0dcptdjmluqvdx9k3"],
    [P3, P1, "asset1aqrdypg669jgazruv5ah07nuyqe0wxjhe2el6f"],
    [P1, P3, "asset17jd78wukhtrnmjh3fngzasxm8rck0l2r4hhyyt"],
    [
      P1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "asset1pkpwyknlvul7az0xx8czhl60pyel45rpje4z8w",
    ],
  ])("matches the spec for policy %s name %s", (policy, name, expected) => {
    expect(assetFingerprint(policy, name)).toBe(expected);
  });

  it("refuses to fingerprint bytes it could not parse", () => {
    expect(assetFingerprint("not-hex", "")).toBeNull();
    // A policy ID is 28 bytes. Anything else is not a policy ID, and hashing it
    // anyway would produce a confident identifier for nothing.
    expect(assetFingerprint("ab".repeat(20), "")).toBeNull();
  });
});

describe("asset names are bytes, not text", () => {
  it("decodes a plain UTF-8 name", () => {
    // "PATATE"
    expect(decodeAssetName("504154415445")).toEqual({ kind: "text", text: "PATATE" });
  });

  it("keeps an empty name distinct from a missing one", () => {
    expect(decodeAssetName("")).toEqual({ kind: "empty" });
    expect(assetLabel("").label).toBe("(no name)");
  });

  it("refuses bytes that are not valid UTF-8", () => {
    expect(decodeAssetName("fffe")).toEqual({ kind: "binary", reason: "not_utf8" });
  });

  it("refuses a name carrying a bidi override", () => {
    // "A" + U+202E RIGHT-TO-LEFT OVERRIDE + "B": renders reversed, which is how
    // one token's name is made to read as another's.
    const hex = Buffer.from("A‮B", "utf8").toString("hex");
    expect(decodeAssetName(hex)).toEqual({ kind: "binary", reason: "not_printable" });
  });

  it("refuses a name carrying a zero-width space", () => {
    const hex = Buffer.from("US​DC", "utf8").toString("hex");
    expect(decodeAssetName(hex)).toEqual({ kind: "binary", reason: "not_printable" });
  });

  it("refuses control characters", () => {
    expect(decodeAssetName("410942")).toEqual({ kind: "binary", reason: "not_printable" });
  });

  it("round-trips every decoded name back to the exact bytes", () => {
    // The property that makes decoding safe: a name shown as text must encode
    // back to what the ledger holds, or it is not that name.
    const names = ["504154415445", "", "fffe", "410942", "e29ca8", "f09f9880"];
    for (const hex of names) {
      const decoded = decodeAssetName(hex);
      if (decoded.kind !== "text") continue;
      expect(Buffer.from(decoded.text, "utf8").toString("hex")).toBe(hex);
    }
  });

  it("marks a decoded label as non-canonical so the hex is shown too", () => {
    expect(assetLabel("504154415445")).toEqual({ label: "PATATE", canonical: false });
    expect(assetLabel("fffe")).toEqual({ label: "fffe", canonical: true });
  });
});

describe("asset units", () => {
  it("splits a unit at the policy boundary", () => {
    const policy = "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373";
    expect(parseAssetUnit(policy + "504154415445")).toEqual({
      policyId: policy,
      nameHex: "504154415445",
    });
    expect(parseAssetUnit(policy)).toEqual({ policyId: policy, nameHex: "" });
  });

  it("rejects anything shorter than a policy ID", () => {
    expect(parseAssetUnit("ab")).toBeNull();
    expect(parseAssetUnit("zz".repeat(28))).toBeNull();
  });
});

describe("quantities", () => {
  it("groups a supply past the safe integer range without rounding it", () => {
    const huge = "18446744073709551615";
    expect(formatQuantity(huge)).toBe("18,446,744,073,709,551,615");
    // The failure this guards: Number(huge) is 18446744073709552000.
    expect(formatQuantity(huge).replace(/,/g, "")).toBe(huge);
  });

  it("leaves a non-numeric quantity exactly as it arrived", () => {
    expect(formatQuantity("not-a-number")).toBe("not-a-number");
  });
});
