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

  it("falls back to an absolute timestamp beyond 30 days", () => {
    expect(relativeTime("2026-01-01T00:00:00.000Z", now)).toBe("2026-01-01 00:00:00 UTC");
  });

  /**
   * The 30-day switch, at the boundary rather than well past it.
   *
   * The case above uses a date 208 days old, so it proved the branch existed
   * and never located it. That mattered: the absolute form is roughly three
   * times the width of the relative one, so a table sized for `30d ago`
   * overflows the day a row reaches 31 days. The e2e fixture is built from one
   * fixed instant, and when that instant aged past this line the deposits
   * layout assertion began failing on every machine, reporting
   * `1465px > 1390px` as though a stylesheet had changed.
   */
  it.each([
    ["2026-06-29T12:00:00.000Z", "29d ago", "inside"],
    ["2026-06-28T12:00:00.000Z", "30d ago", "at the boundary"],
  ])("renders %s as %s (%s)", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it("switches to the wider absolute form at 31 days, not 30", () => {
    expect(relativeTime("2026-06-28T12:00:00.000Z", now)).toBe("30d ago");
    expect(relativeTime("2026-06-27T12:00:00.000Z", now)).toBe("2026-06-27 12:00:00 UTC");
  });

  it("renders the absolute form far wider than the relative one", () => {
    const relative = relativeTime("2026-06-28T12:00:00.000Z", now);
    const absolute = relativeTime("2026-06-27T12:00:00.000Z", now);
    expect(absolute.length).toBeGreaterThan(relative.length * 2);
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
