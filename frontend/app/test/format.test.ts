import { describe, expect, it } from "vitest";
import type { AssetMap } from "@midgard-explorer/contracts";
import {
  assetCount,
  cn,
  formatAda,
  formatDuration,
  formatTimestamp,
  groupThousands,
  relativeTime,
  truncateId,
} from "../src/lib/format";

describe("formatAda", () => {
  it("renders whole ada without a fractional part", () => {
    expect(formatAda("5000000")).toBe("5");
  });

  it("groups thousands and trims trailing zeros in the fraction", () => {
    expect(formatAda("1234567890")).toBe("1,234.56789");
  });

  it("keeps full precision for sub-ada amounts", () => {
    expect(formatAda("1")).toBe("0.000001");
  });

  it("stays exact beyond Number.MAX_SAFE_INTEGER", () => {
    // 2^53 lovelace + 1: Number arithmetic would lose the trailing digit.
    expect(formatAda("9007199254740993")).toBe("9,007,199,254.740993");
  });

  it("accepts bigint as well as string", () => {
    expect(formatAda(2_500_000n)).toBe("2.5");
  });
});

describe("groupThousands", () => {
  it.each([
    ["1", "1"],
    ["999", "999"],
    ["1000", "1,000"],
    ["1234567", "1,234,567"],
  ])("groups %s as %s", (input, expected) => {
    expect(groupThousands(input)).toBe(expected);
  });
});

describe("truncateId", () => {
  it("leaves short ids untouched", () => {
    expect(truncateId("abcdef")).toBe("abcdef");
  });

  it("keeps head and tail around an ellipsis", () => {
    const id = "a".repeat(64);
    expect(truncateId(id)).toBe(`${"a".repeat(8)}…${"a".repeat(8)}`);
  });

  it("honours custom head and tail lengths", () => {
    expect(truncateId("0123456789abcdef", 4, 4)).toBe("0123…cdef");
  });
});

describe("formatTimestamp", () => {
  it("renders an ISO instant as UTC", () => {
    expect(formatTimestamp("2026-07-28T12:00:00.000Z")).toBe("2026-07-28 12:00:00 UTC");
  });

  it("returns the raw input when it is not a date", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");

  it.each([
    ["2026-07-28T11:59:30.000Z", "30s ago"],
    ["2026-07-28T11:55:00.000Z", "5m ago"],
    ["2026-07-28T09:00:00.000Z", "3h ago"],
    ["2026-07-26T12:00:00.000Z", "2d ago"],
  ])("renders %s as %s", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  /**
   * The reading gets coarser past a month; it does not stop being relative.
   *
   * It used to fall back to the absolute timestamp, which made one column hold
   * two different kinds of value: rows inside the window read "20d ago" and
   * older ones read "2026-07-26 09:40:43 UTC".
   *
   * The fallback existed for width. The absolute form is about three times the
   * relative one, and when the e2e fixture's fixed instant aged past this line
   * the deposits layout assertion began failing on every machine, reporting
   * `1465px > 1390px` as though a stylesheet had changed. A coarser unit answers
   * that permanently, because "2mo ago" is narrower than "30d ago".
   */
  it.each([
    ["2026-06-29T12:00:00.000Z", "29d ago", "inside the day range"],
    ["2026-06-28T12:00:00.000Z", "1mo ago", "at a month"],
    ["2026-04-28T12:00:00.000Z", "3mo ago", "months"],
    ["2025-07-28T12:00:00.000Z", "1y ago", "a year"],
    ["2023-07-28T12:00:00.000Z", "3y ago", "years"],
  ])("renders %s as %s (%s)", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  /** Never an absolute instant, at any age. That is the inconsistency this
   * replaces, and a regression would reintroduce it silently for old rows
   * only, which is exactly where nobody looks. */
  it("never returns an absolute timestamp, however old the record", () => {
    for (const iso of [
      "2026-06-27T12:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2019-01-01T00:00:00.000Z",
    ]) {
      expect(relativeTime(iso, now)).toMatch(/ ago$/);
      expect(relativeTime(iso, now)).not.toContain("UTC");
    }
  });

  /** The width the fallback was protecting, now bounded at every age rather
   * than only inside the window. */
  it("never renders wider than the longest day reading", () => {
    const widest = "30d ago".length;
    for (const iso of [
      "2026-06-29T12:00:00.000Z",
      "2026-06-27T12:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2019-01-01T00:00:00.000Z",
    ]) {
      expect(relativeTime(iso, now).length).toBeLessThanOrEqual(widest);
    }
  });

  it("never reports a negative age for clock skew", () => {
    expect(relativeTime("2026-07-28T12:00:30.000Z", now)).toBe("0s ago");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [-5, "0s"],
    [1500, "1.5s"],
    [21_000, "21s"],
    [95_000, "1m 35s"],
    [3_930_000, "1h 5m"],
    [86_340_000, "23h 59m"],
    [86_400_000, "1d 0h"],
    // The figure that prompted this: a chain quiet for twenty days, which read
    // as "485h 45m" before.
    [1_748_752_000, "20d 5h"],
  ])("renders %sms as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it("guards against non-finite input", () => {
    expect(formatDuration(Number.NaN)).toBe("0s");
  });
});

describe("assetCount", () => {
  /** Quantities are branded DecimalString; fixtures build the shape directly
   * rather than routing through a decoder the test is not exercising. */
  const assets = (m: Record<string, Record<string, string>>) => m as unknown as AssetMap;

  it("counts asset names across every policy", () => {
    expect(assetCount(assets({ p1: { a: "1", b: "2" }, p2: { c: "3" } }))).toBe(3);
  });

  it("is zero for an empty map", () => {
    expect(assetCount(assets({}))).toBe(0);
  });
});

describe("cn", () => {
  it("drops falsy parts and joins the rest", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });
});
