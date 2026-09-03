import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

/**
 * The double models the client's contract, including `$transaction`.
 *
 * The aggregate now reads inside one `READ ONLY REPEATABLE READ` transaction,
 * and a stub carrying only `$queryRaw` stopped being a stand-in for the client
 * the moment that changed: the failure was `prisma.$transaction is not a
 * function`, which is the double falling behind rather than the query changing.
 * Running the callback inline keeps these cases about the SQL, which is what
 * they assert, while still exercising the path through the transaction.
 */
vi.mock("../src/db.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $transaction: (work: (reader: unknown) => unknown) => work({ $queryRaw: mocks.queryRaw }),
    addressHistory: { findMany: vi.fn() },
  },
}));

import { getAddressHistory } from "../src/db/address.js";

const sqlText = (call: unknown[]) => Array.from(call[0] as TemplateStringsArray).join(" ");

describe("address history query", () => {
  beforeEach(() => mocks.queryRaw.mockReset());

  it("uses durable journal membership and all transaction body tiers", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0n, first_activity: null, latest_activity: null }]);

    await getAddressHistory("addr_test1example", 1);

    const pageSql = sqlText(mocks.queryRaw.mock.calls[0]);
    expect(pageSql).toContain("FROM address_history AS ah");
    expect(pageSql).toContain("pending_block_finalization_txs");
    expect(pageSql).toContain("pending_block_finalizations");
    expect(pageSql).toContain("processed_mempool");
    expect(pageSql).toContain("mempool");
    expect(pageSql).toContain("immutable");
    expect(pageSql).toContain("jm.tx_id IS NULL");
  });

  it("bounds pages and reports totals and activity across all rows", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ tx_id: Buffer.from("ab", "hex") }])
      .mockResolvedValueOnce([
        {
          total: 51n,
          first_activity: new Date("2026-01-01T00:00:00Z"),
          latest_activity: new Date("2026-01-02T00:00:00Z"),
        },
      ]);

    const result = await getAddressHistory("addr_test1example", 2);

    expect(result.limit).toBe(25);
    expect(result.total).toBe(51);
    expect(result.hasNextPage).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.firstActivity?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(result.latestActivity?.toISOString()).toBe("2026-01-02T00:00:00.000Z");

    const pageCall = mocks.queryRaw.mock.calls[0];
    expect(pageCall).toContain(25);
  });
});
