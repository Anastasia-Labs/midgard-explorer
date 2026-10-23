import { describe, expect, it } from "vitest";
import { newRowCount } from "../src/lib/livelist";

/**
 * Phase 4.2b: hold new rows instead of inserting them under the reader.
 *
 * Every list here polls, so rows arrive while someone is reading. Inserting
 * them at the top pushes the row they were looking at down the page, which is
 * the one thing a reader cannot recover from. Counting what is new is the whole
 * of the logic; the banner is a button around this number.
 */

type Row = { id: string };
const key = (r: Row) => r.id;
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("counting what arrived", () => {
  it("is zero when nothing changed", () => {
    expect(newRowCount(rows("a", "b"), rows("a", "b"), key)).toBe(0);
  });

  it("counts a single new row at the head", () => {
    expect(newRowCount(rows("a", "b"), rows("c", "a", "b"), key)).toBe(1);
  });

  it("counts several", () => {
    expect(newRowCount(rows("a"), rows("d", "c", "b", "a"), key)).toBe(3);
  });

  it("ignores rows that fell off the end as the window moved", () => {
    // A fixed-length window drops the oldest row for every new one. Only what
    // arrived is news; what left is not.
    expect(newRowCount(rows("b", "a"), rows("c", "b"), key)).toBe(1);
  });

  it("is zero when the same rows come back in a different order", () => {
    expect(newRowCount(rows("a", "b"), rows("b", "a"), key)).toBe(0);
  });

  it("counts every row when the list was empty", () => {
    expect(newRowCount([], rows("a", "b"), key)).toBe(2);
  });

  it("is zero when the poll returned nothing", () => {
    expect(newRowCount(rows("a"), [], key)).toBe(0);
  });
});
