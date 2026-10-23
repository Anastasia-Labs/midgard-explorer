import { describe, expect, it } from "vitest";
import {
  parseHexOfLength,
  parseOptionalHexQuery,
  parsePageParam,
  parsePageQuery,
} from "../src/server/validate.js";

/**
 * Nothing covered these checks before they were shared, in any route.
 *
 * That is why `2.5` reached the database helpers and was floored to page 2:
 * every route asserted `Number.isFinite`, which a fraction satisfies, and no
 * test asked what a fractional page did.
 */
describe("parsePageParam", () => {
  it("accepts a positive integer", () => {
    expect(parsePageParam("3")).toEqual({ ok: true, value: 3 });
  });

  it("rejects a fraction rather than flooring it", () => {
    expect(parsePageParam("2.5").ok).toBe(false);
  });

  it.each(["0", "-1", "abc", "", undefined, null, "Infinity", "1e400"])(
    "rejects %o",
    (raw) => {
      expect(parsePageParam(raw).ok).toBe(false);
    },
  );

  it("carries the message the routes returned before", () => {
    const result = parsePageParam("abc");
    expect(result.ok === false && result.error).toBe("Invalid page.");
  });
});

describe("parsePageQuery", () => {
  it("reads an absent page as the first one", () => {
    expect(parsePageQuery(undefined)).toEqual({ ok: true, value: 1 });
    expect(parsePageQuery("")).toEqual({ ok: true, value: 1 });
  });

  it("still rejects a malformed one", () => {
    expect(parsePageQuery("2.5").ok).toBe(false);
  });
});

describe("parseOptionalHexQuery", () => {
  it("treats absent and empty alike, because `?id=` is how a filter is cleared", () => {
    expect(parseOptionalHexQuery(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseOptionalHexQuery("")).toEqual({ ok: true, value: undefined });
  });

  it("lower-cases, so the same identifier in either case is one query", () => {
    expect(parseOptionalHexQuery("ABCD")).toEqual({ ok: true, value: "abcd" });
  });

  it("rejects a non-hex filter", () => {
    const result = parseOptionalHexQuery("zz");
    expect(result.ok === false && result.error).toBe("id must be hexadecimal.");
  });
});

describe("parseHexOfLength", () => {
  it("accepts an exact-length hash and lower-cases it", () => {
    expect(parseHexOfLength("A".repeat(56), 56, "headerHash")).toEqual({
      ok: true,
      value: "a".repeat(56),
    });
  });

  it.each([55, 57])("rejects length %i against a 56 requirement", (length) => {
    expect(parseHexOfLength("a".repeat(length), 56, "headerHash").ok).toBe(false);
  });

  it("names the field, so the caller knows which one was wrong", () => {
    const result = parseHexOfLength("nope", 64, "txHash");
    expect(result.ok === false && result.error).toBe(
      "txHash must be 64 hex characters.",
    );
  });

  it("rejects a missing value rather than reading it as the empty string", () => {
    expect(parseHexOfLength(undefined, 56, "scriptHash").ok).toBe(false);
  });
});
