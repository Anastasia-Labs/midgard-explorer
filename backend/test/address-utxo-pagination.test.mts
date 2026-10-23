import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  computeBalance: vi.fn(),
  decodeUtxos: vi.fn(),
  decodeTransactionSafe: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $transaction: (work: (reader: unknown) => unknown) => work({ $queryRaw: mocks.queryRaw }),
    addressHistory: { findMany: vi.fn() },
  },
}));

vi.mock("../src/decode/transaction.js", () => ({
  computeBalance: mocks.computeBalance,
  decodeUtxos: mocks.decodeUtxos,
  decodeTransactionSafe: mocks.decodeTransactionSafe,
}));

import { getAddressUtxos, pageUtxoRows, UTXO_PAGE_LIMIT } from "../src/db/address.js";
import { getAddressRoute } from "../src/server/routes/address.js";

const sqlText = (call: unknown[]) => Array.from(call[0] as TemplateStringsArray).join(" ");

/** A row whose outref sorts by its final byte, so input order is never the answer. */
const row = (n: number) => ({
  outref: Buffer.from([0xaa, 0xbb, n]),
  output: Buffer.from([n]),
});

describe("address UTxO query", () => {
  beforeEach(() => mocks.queryRaw.mockReset());

  it("does not sort in SQL: the ordering is applied to 36-byte keys in memory", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    await getAddressUtxos("addr_test1example");

    const sql = sqlText(mocks.queryRaw.mock.calls[0]);
    // The SQL sort spilled 98.8 MB to temp per request on the target profile,
    // because it sorted whole rows including the `output` payload.
    expect(sql).not.toContain("ORDER BY");
    expect(sql).not.toContain("encode(");
    expect(sql).toContain("FROM mempool_ledger");
  });
});

describe("pageUtxoRows", () => {
  it("orders by outref bytes regardless of the order the rows arrive in", () => {
    const rows = [row(3), row(1), row(2)];
    const { page } = pageUtxoRows(rows, undefined, 10);
    expect(page.map((r) => r.outref[2])).toEqual([1, 2, 3]);
  });

  it("bounds the page to the limit", () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(i));
    const { page } = pageUtxoRows(rows, undefined, 50);
    expect(page).toHaveLength(50);
  });

  it("walks the whole set by cursor with no gaps and no duplicates", () => {
    const rows = Array.from({ length: 37 }, (_, i) => row(i));
    const seen: number[] = [];
    let cursor: string | undefined = undefined;
    for (let guard = 0; guard < 20; guard++) {
      const result = pageUtxoRows(rows, cursor, 10);
      seen.push(...result.page.map((r) => r.outref[2]));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect(new Set(seen).size).toBe(37);
  });

  it("reports nextCursor null on the final page", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i));
    const last = pageUtxoRows(rows, pageUtxoRows(rows, undefined, 10).nextCursor!, 10);
    expect(last.page).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
  });

  it("returns the total across every row, not the page", () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(i));
    expect(pageUtxoRows(rows, undefined, 50).total).toBe(200);
  });
});

describe("address route", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.computeBalance.mockReset();
    mocks.decodeUtxos.mockReset();
    mocks.decodeTransactionSafe.mockReset();
    mocks.computeBalance.mockResolvedValue({
      balance: { lovelace: "0", assets: {} },
      undecodedOutputs: 0,
    });
    mocks.decodeUtxos.mockResolvedValue([]);
  });

  it("computes the balance over EVERY UTxO while returning only a page", async () => {
    const total = 500;
    const rows = Array.from({ length: total }, (_, i) => row(i));
    mocks.queryRaw
      // getAddressHistory: page, then totals
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0n, first_activity: null, latest_activity: null }])
      // getAddressUtxos
      .mockResolvedValueOnce(rows);

    const json = vi.fn();
    const res = { json, status: vi.fn(() => ({ json })) } as never;
    await getAddressRoute({ query: { address: "addr_test1example", page: "1" } } as never, res);

    // The correctness property: a balance from the page alone would be wrong.
    expect(mocks.computeBalance).toHaveBeenCalledTimes(1);
    expect(mocks.computeBalance.mock.calls[0][0]).toHaveLength(total);

    // The memory property: only a page is decoded into view objects.
    expect(mocks.decodeUtxos).toHaveBeenCalledTimes(1);
    expect(mocks.decodeUtxos.mock.calls[0][0]).toHaveLength(UTXO_PAGE_LIMIT);

    const body = json.mock.calls[0][0];
    expect(body.utxoCount).toBe(total);
    expect(body.hasMoreUtxos).toBe(true);
    expect(body.utxoCursor).toBeTypeOf("string");
  });
});
