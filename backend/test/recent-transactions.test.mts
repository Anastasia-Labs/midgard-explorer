import express from "express";
import { afterAll, describe, expect, it, vi } from "vitest";

/** The overview's latest transactions must carry the block's settlement next
 * to the lifecycle status, or a committed row reads as settled. */

const lastTransactions = vi.fn();

vi.mock("../src/db/block.js", () => ({
  getLastTransactions: (...args: unknown[]) => lastTransactions(...args),
  getBlockFinalization: vi.fn(),
}));

const app = express();
app.get("/api/transactions/recent", async (req, res) => {
  const { getRecentTransactionsRoute } = await import("../src/server/routes/transaction.js");
  return getRecentTransactionsRoute(req, res);
});
const server = app.listen(0);
const port = () => (server.address() as { port: number }).port;
afterAll(() => server.close());

describe("recent transactions", () => {
  it("carries the block's settlement status beside the lifecycle status", async () => {
    lastTransactions.mockResolvedValue([
      {
        height: 7,
        header_hash: new Uint8Array(28).fill(1),
        tx_id: new Uint8Array(32).fill(2),
        time_stamp_tz: new Date("2026-09-22T00:00:00Z"),
        finalization_status: "pending_submission",
      },
    ]);
    const res = await fetch(`http://127.0.0.1:${port()}/api/transactions/recent`);
    const body = (await res.json()) as { rows: Array<Record<string, unknown>> };
    expect(body.rows[0]?.status).toBe("committed");
    expect(body.rows[0]?.finalization_status).toBe("pending_submission");
  });
});
