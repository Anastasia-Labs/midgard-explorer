import { describe, expect, it } from "vitest";
import { bech32ChecksumValid, classify, hrefFor } from "../src/lib/classify";

/** Independent BIP-173 encoder, so the checksum verifier is checked against a
 * generator rather than against itself. */
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function toWords(bytes: number[]): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

function encodeBech32(hrp: string, bytes: number[]): string {
  const words = toWords(bytes);
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join("")}`;
}

const payload = Array.from({ length: 28 }, (_, i) => (i * 7 + 3) & 0xff);
const VALID_TESTNET = encodeBech32("addr_test", payload);
const VALID_MAINNET = encodeBech32("addr", payload);
const VALID_STAKE = encodeBech32("stake_test", payload);

describe("bech32ChecksumValid", () => {
  it("accepts a correctly encoded address", () => {
    expect(bech32ChecksumValid(VALID_TESTNET)).toBe(true);
  });

  it("rejects a single mutated character", () => {
    const flipped = VALID_TESTNET.slice(0, -1) + (VALID_TESTNET.at(-1) === "q" ? "p" : "q");
    expect(bech32ChecksumValid(flipped)).toBe(false);
  });

  it("rejects mixed case", () => {
    expect(
      bech32ChecksumValid(VALID_TESTNET.slice(0, 12).toUpperCase() + VALID_TESTNET.slice(12)),
    ).toBe(false);
  });

  it("rejects a string with no separator", () => {
    expect(bech32ChecksumValid("addrtest")).toBe(false);
  });

  it("rejects characters outside the charset", () => {
    expect(bech32ChecksumValid("addr_test1bbbbbbbb")).toBe(false);
  });
});

describe("classify", () => {
  it("recognises a 64-hex transaction hash and lowercases it", () => {
    const hash = "A".repeat(64);
    expect(classify(hash)).toEqual({ kind: "transaction", value: "a".repeat(64) });
  });

  it("recognises a 56-hex block header hash", () => {
    expect(classify("b".repeat(56))).toEqual({ kind: "block", value: "b".repeat(56) });
  });

  it("recognises testnet, mainnet and stake addresses", () => {
    expect(classify(VALID_TESTNET).kind).toBe("address");
    expect(classify(VALID_MAINNET).kind).toBe("address");
    expect(classify(VALID_STAKE).kind).toBe("address");
  });

  it("trims surrounding whitespace from pasted values", () => {
    expect(classify(`  ${"c".repeat(64)}\n`)).toEqual({
      kind: "transaction",
      value: "c".repeat(64),
    });
  });

  it("rejects an address whose checksum does not verify, and says why", () => {
    const broken = VALID_TESTNET.slice(0, -1) + (VALID_TESTNET.at(-1) === "q" ? "p" : "q");
    const result = classify(broken);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toMatch(/checksum/i);
  });

  it("explains a hex string of the wrong length instead of guessing", () => {
    const result = classify("d".repeat(60));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.reason).toContain("60");
      expect(result.reason).toContain("64");
      expect(result.reason).toContain("56");
    }
  });

  it("asks for input when the field is empty", () => {
    const result = classify("   ");
    expect(result).toEqual({ kind: "invalid", reason: "Enter a search term." });
  });

  it("rejects unrecognised input", () => {
    expect(classify("hello world").kind).toBe("invalid");
  });

  it("never routes a 56-hex value to the transaction route", () => {
    expect(classify("e".repeat(56)).kind).not.toBe("transaction");
  });
});

describe("hrefFor", () => {
  it.each([
    [{ kind: "transaction", value: "abc" } as const, "/transaction/abc"],
    [{ kind: "block", value: "def" } as const, "/block/def"],
    [{ kind: "address", value: "addr1x" } as const, "/address/addr1x"],
  ])("routes %o to %s", (c, expected) => {
    expect(hrefFor(c)).toBe(expected);
  });

  it("has no destination for invalid input", () => {
    expect(hrefFor({ kind: "invalid", reason: "nope" })).toBeNull();
  });
});
