import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_OFFSET_ROWS,
  maxPageFor,
  parseHexOfLength,
  parseHintedPage,
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

/**
 * The page-depth bound.
 *
 * Every list route answers page N by producing N x pageSize rows and throwing
 * all but the last page away, so the work grows with the page number while the
 * response does not. `?page=999999999` on the address route computed
 * `OFFSET 24999999975` and held a connection for as long as the statement
 * timeout allowed. These cover the inputs that reach the multiplication.
 */
describe("the page-depth bound", () => {
  it("serves the last page inside the bound and refuses the one past it", () => {
    const last = maxPageFor(25);
    expect(last).toBe(4_000);
    expect(parsePageParam(String(last), 25)).toEqual({ ok: true, value: last });
    expect(parsePageParam(String(last + 1), 25).ok).toBe(false);
  });

  it("scales the bound to the route's page size, because the bound is on rows", () => {
    expect(maxPageFor(50)).toBe(2_000);
    expect(maxPageFor(10)).toBe(10_000);
    // A page size larger than the whole bound still leaves the first page.
    expect(maxPageFor(MAX_PAGE_OFFSET_ROWS * 2)).toBe(1);
  });

  it("names the last page it will serve, rather than refusing without a number", () => {
    const result = parsePageParam("900000000", 25);
    expect(result.ok === false && result.error).toBe(
      "Page 900000000 is past the last page this route serves (4000).",
    );
  });

  /* The register's own example, and the three numeric shapes a range check
   * alone would let through: an integer too large to be exact, a float that is
   * not finite, and one that is not a number at all. None may reach the
   * multiplication that turns a page into an offset. */
  it.each(["999999999", "24999999975", "1e308", "Infinity", "-Infinity", "NaN", "9007199254740993"])(
    "refuses %s before any offset is computed",
    (raw) => {
      expect(parsePageParam(raw, 25).ok).toBe(false);
    },
  );

  it("bounds the query-string form the address route uses", () => {
    expect(parsePageQuery("", 25)).toEqual({ ok: true, value: 1 });
    expect(parsePageQuery("4000", 25).ok).toBe(true);
    expect(parsePageQuery("4001", 25).ok).toBe(false);
  });

  /* The Cardano activity route treats a page number as a navigation hint and
   * coerces a malformed one. That ruling is about malformed input: depth is a
   * separate question, and silently clamping it would hide the refusal. */
  describe("a page number that is a navigation hint", () => {
    it.each(["abc", "0", "-3", "2.5", ""])("coerces %o to the first page", (raw) => {
      expect(parseHintedPage(raw, 25)).toEqual({ ok: true, value: 1 });
    });

    it("refuses excessive depth rather than clamping it", () => {
      expect(parseHintedPage("4000", 25)).toEqual({ ok: true, value: 4_000 });
      const result = parseHintedPage("999999999", 25);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toMatch(/past the last page/);
    });
  });
});
