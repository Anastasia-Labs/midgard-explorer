import { describe, expect, it } from "vitest";
import { summarise } from "../ingest/summarise.js";

/**
 * A block's records, cut into bounded pages.
 *
 * A page holds at most `records` records and `bytes` bytes, so serving one is
 * one bounded read. A record too large for a page gets its own detail object;
 * one too large even for that keeps only its summary and a link into the
 * archived raw payload. Small budgets here stand in for 50 records and 1 MB.
 */

const FP = "ab".repeat(32);
const BLOCK = `${"cd".repeat(28)}-${"ef".repeat(32)}-v1`;
const PAYLOAD = `${FP}/payloads/${"cd".repeat(28)}-${"ef".repeat(32)}.cbor`;
const BUDGET = { records: 3, bytes: 400, detailBytes: 1_000 };
const entry = (i: number, valueBytes = 4): [string, string] => [
  i.toString(16).padStart(64, "0"),
  "aa".repeat(valueBytes),
];
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));

describe("block pages", () => {
  it("hold at most the record and byte budget, in order, covering every record", () => {
    const out = summarise({ fingerprint: FP, block: BLOCK, payloadKey: PAYLOAD, kind: "transactions", entries: Array.from({ length: 7 }, (_, i) => entry(i)), budget: BUDGET });
    const pages = Object.entries(out.pages).sort(([a], [b]) => a.localeCompare(b));
    expect(pages.map(([key]) => key.split("/").at(-1))).toEqual(["0.json", "1.json", "2.json"]);
    const records = pages.flatMap(([, bytes]) => {
      expect(bytes.length).toBeLessThanOrEqual(BUDGET.bytes);
      const page = decode(bytes);
      expect(page.records.length).toBeLessThanOrEqual(BUDGET.records);
      return page.records.map((r: { index: number }) => r.index);
    });
    expect(records).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(out.count).toEqual({ records: 7, pages: 3 });
  });

  it("move a record larger than a page into a detail object, linked from its page", () => {
    const out = summarise({ fingerprint: FP, block: BLOCK, payloadKey: PAYLOAD, kind: "transactions", entries: [entry(0), entry(1, 300)], budget: BUDGET });
    const all = Object.values(out.pages).flatMap((bytes) => decode(bytes).records);
    const big = all.find((r: { index: number }) => r.index === 1);
    expect(big.value).toBeUndefined();
    expect(big.valueBytes).toBe(300);
    expect(decode(out.details[big.detailKey]!).value).toBe("aa".repeat(300));
  });

  it("keep only a summary and a raw-payload link for a record over the detail budget", () => {
    const out = summarise({ fingerprint: FP, block: BLOCK, payloadKey: PAYLOAD, kind: "deposits", entries: [entry(0, 2_000)], budget: BUDGET });
    expect(out.details).toEqual({});
    const record = decode(Object.values(out.pages)[0]!).records[0];
    expect(record).toMatchObject({ index: 0, valueBytes: 2_000, raw: { payloadKey: PAYLOAD, kind: "deposits", index: 0 } });
  });
});
