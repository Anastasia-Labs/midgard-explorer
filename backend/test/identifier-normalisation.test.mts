import { describe, expect, it } from "vitest";
import { isHash28, isHash32, canonicalHash, HASH28_HEX, HASH32_HEX } from "../src/utils.js";

/**
 * One identifier, one canonical form, decided at the boundary.
 *
 * The two protocol hash widths were written as inline regular expressions in
 * eighteen places, and they did not agree with each other: the backend's own
 * helper accepts either case, the OpenAPI document advertises lowercase, and
 * the routes differ over whether they normalise before querying.
 *
 * That disagreement was live. `/api/block` with an UPPERCASE header hash passed
 * validation, found the block (the node stores bytea, and `Buffer.from` reads
 * either case), and then missed in the Cardano index, which compares strings
 * against a lowercase key. The response came back `reconciliation: node_only`
 * for a block the index had attributed perfectly, which is the same false
 * "not observed" claim the canonical-key repair exists to end, reached by a
 * different route.
 *
 * Normalising once, where the identifier enters, is what makes a hash mean the
 * same thing to both databases.
 */

const LOWER = "6f77bd238790f437971176e41b6c04ecf8eb04af01cf6c8fedfbcc8b";
const UPPER = LOWER.toUpperCase();
const TX = "7fbb05d40afa53d1d2646e5e6652bebc92a4abec2e11eaa5a8bb5d470a48264e";

describe("the widths are named once", () => {
  it("states the two protocol widths", () => {
    expect(HASH28_HEX).toBe(56);
    expect(HASH32_HEX).toBe(64);
  });
});

describe("what counts as a hash", () => {
  it("accepts a canonical lowercase hash", () => {
    expect(isHash28(LOWER)).toBe(true);
    expect(isHash32(TX)).toBe(true);
  });

  /** A person pasting a hash from another explorer may paste it uppercase, and
   * refusing that is pedantry. Accepting it and then querying with it is the
   * defect; accepting it and normalising is the fix. */
  it("accepts an uppercase hash as input", () => {
    expect(isHash28(UPPER)).toBe(true);
    expect(isHash32(TX.toUpperCase())).toBe(true);
  });

  it("rejects the wrong width", () => {
    expect(isHash28(TX)).toBe(false);
    expect(isHash32(LOWER)).toBe(false);
  });

  it("rejects non-hex", () => {
    expect(isHash28("z".repeat(56))).toBe(false);
    expect(isHash32("")).toBe(false);
  });
});

describe("canonicalHash", () => {
  /** The whole point: two spellings of one identifier become one value before
   * either database sees it. */
  it("maps both spellings to the same value", () => {
    expect(canonicalHash(UPPER)).toBe(LOWER);
    expect(canonicalHash(LOWER)).toBe(LOWER);
    expect(canonicalHash(UPPER)).toBe(canonicalHash(LOWER));
  });

  it("leaves a canonical hash untouched", () => {
    expect(canonicalHash(TX)).toBe(TX);
  });

  it("trims surrounding whitespace, which a paste commonly carries", () => {
    expect(canonicalHash(`  ${UPPER} `)).toBe(LOWER);
  });
});
