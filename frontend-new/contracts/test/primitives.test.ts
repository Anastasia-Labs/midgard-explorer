import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  DecimalString,
  Hash28,
  Hash32,
  HexString,
  IsoTimestamp,
  SignedDecimalString,
} from "../src/primitives.js";

/**
 * The contracts package reported a passing test run with no test files in it,
 * so every schema below was unverified while the gate said green.
 *
 * `IsoTimestamp` was `Schema.String` and accepted anything. A manifest with no
 * `createdAt` reached the UI as the literal string "undefined" and threw inside
 * `new Date(...).toISOString()` when the source banner rendered it. A decode
 * boundary that accepts every string is not a boundary.
 */

const accepts = <A, I>(schema: Schema.Schema<A, I>, input: I) =>
  Schema.decodeUnknownEither(schema)(input)._tag === "Right";

describe("IsoTimestamp", () => {
  it("accepts a real ISO timestamp", () => {
    expect(accepts(IsoTimestamp, "2026-07-15T17:25:29.000Z")).toBe(true);
  });

  it("rejects the string that reached the UI and threw", () => {
    expect(accepts(IsoTimestamp, "undefined")).toBe(false);
  });

  it("rejects an empty string and unparseable text", () => {
    for (const bad of ["", "not a date", "2026-13-45T99:99:99Z"]) {
      expect(accepts(IsoTimestamp, bad)).toBe(false);
    }
  });
});

describe("Hash28 and Hash32", () => {
  it("accept hashes of exactly the right length", () => {
    expect(accepts(Hash28, "a".repeat(56))).toBe(true);
    expect(accepts(Hash32, "a".repeat(64))).toBe(true);
  });

  it("reject the other length, which HexString could not tell apart", () => {
    expect(accepts(Hash28, "a".repeat(64))).toBe(false);
    expect(accepts(Hash32, "a".repeat(56))).toBe(false);
  });

  it("reject an empty string", () => {
    expect(accepts(Hash28, "")).toBe(false);
    expect(accepts(Hash32, "")).toBe(false);
  });

  it("reject non-hex characters", () => {
    expect(accepts(Hash28, "z".repeat(56))).toBe(false);
  });
});

describe("HexString", () => {
  it("accepts hex of any length, which is why a hash needs its own schema", () => {
    expect(accepts(HexString, "abc")).toBe(true);
    expect(accepts(HexString, "")).toBe(true);
  });

  it("rejects non-hex", () => {
    expect(accepts(HexString, "zz")).toBe(false);
  });
});

describe("decimal strings", () => {
  it("accepts unsigned digits and rejects a negative", () => {
    expect(accepts(DecimalString, "1000000")).toBe(true);
    expect(accepts(DecimalString, "-1")).toBe(false);
  });

  it("accepts a negative signed value, which is how a burn is expressed", () => {
    expect(accepts(SignedDecimalString, "-1")).toBe(true);
    expect(accepts(SignedDecimalString, "1")).toBe(true);
  });

  it("rejects text and decimals in both", () => {
    for (const bad of ["1.5", "abc", ""]) {
      expect(accepts(DecimalString, bad)).toBe(false);
      expect(accepts(SignedDecimalString, bad)).toBe(false);
    }
  });
});
