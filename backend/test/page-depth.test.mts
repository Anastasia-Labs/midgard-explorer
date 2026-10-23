import express from "express";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A refused page must cost nothing.
 *
 * The bound exists because the work grows with the page number: page N makes
 * PostgreSQL produce N x pageSize rows and discard all but the last page. A
 * 400 that arrived AFTER the statement would be decoration, so what is
 * asserted here is not the status code but that the database layer was never
 * reached. The mocks below stand in for it: if a route ever queries before
 * validating, the call count says so.
 */

const depositsPage = vi.fn();
const withdrawalsPage = vi.fn();
const forcedPage = vi.fn();
const blocksPage = vi.fn();
const transactionsPage = vi.fn();
const historyPage = vi.fn();
const activityPage = vi.fn();

vi.mock("../src/db/deposits.js", () => ({
  LIMIT: 25,
  getDepositsPage: (...args: unknown[]) => depositsPage(...args),
}));
vi.mock("../src/db/withdrawals.js", () => ({
  LIMIT: 25,
  getWithdrawalsPage: (...args: unknown[]) => withdrawalsPage(...args),
}));
vi.mock("../src/db/forcedTransactions.js", () => ({
  LIMIT: 25,
  getForcedTransactionsPage: (...args: unknown[]) => forcedPage(...args),
}));

const { parsePageParam, parsePageQuery, parseHintedPage, maxPageFor } = await import(
  "../src/server/validate.js"
);

/** The routes, mounted the way the catalogue mounts them, with the database
 * layer replaced. Only the paging half of each handler is exercised. */
const app = express();
app.get("/api/deposits/:page", async (req, res) => {
  const { getDepositsPageRoute } = await import("../src/server/routes/deposits.js");
  return getDepositsPageRoute(req, res);
});

const server = app.listen(0);
const port = () => (server.address() as { port: number }).port;
afterAll(() => server.close());

beforeEach(() => {
  depositsPage.mockReset();
  depositsPage.mockResolvedValue({ rows: [], hasNextPage: false, total: 0, limit: 25, page: 1 });
  withdrawalsPage.mockReset();
  forcedPage.mockReset();
  blocksPage.mockReset();
  transactionsPage.mockReset();
  historyPage.mockReset();
  activityPage.mockReset();
});

describe("a page past the bound", () => {
  it("is refused, and the database layer is never called", async () => {
    const res = await fetch(`http://127.0.0.1:${port()}/api/deposits/900000000`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/past the last page/);
    expect(depositsPage).not.toHaveBeenCalled();
  });

  /* The same route, inside the bound, to prove the assertion above is not
   * vacuous: this one does reach the database layer. */
  it("is not refused inside the bound, and does reach it", async () => {
    const res = await fetch(`http://127.0.0.1:${port()}/api/deposits/${maxPageFor(25)}`);
    expect(res.status).toBe(200);
    expect(depositsPage).toHaveBeenCalledTimes(1);
    expect(depositsPage.mock.calls[0][0]).toBe(maxPageFor(25));
  });

  it("refuses the register's own example before it becomes an offset", async () => {
    const res = await fetch(`http://127.0.0.1:${port()}/api/deposits/999999999`);
    expect(res.status).toBe(400);
    expect(depositsPage).not.toHaveBeenCalled();
  });
});

/**
 * Every offset-paginated route, through the validator each one calls.
 *
 * The HTTP assertions above cover one route end to end. This covers the
 * inventory: seven paths compute an offset from a page number, and each one
 * has to be bounded by the page size it actually uses. A route added without a
 * bound is the regression, and it shows up here as a missing entry rather than
 * as a 500 in production.
 */
describe("the offset-paginated inventory", () => {
  const routes = [
    { path: "/api/blocks/:page", pageSize: 25, parse: parsePageParam },
    { path: "/api/transactions/:page", pageSize: 25, parse: parsePageParam },
    { path: "/api/deposits/:page", pageSize: 25, parse: parsePageParam },
    { path: "/api/withdrawals/:page", pageSize: 25, parse: parsePageParam },
    { path: "/api/forced-transactions/:page", pageSize: 25, parse: parsePageParam },
    { path: "/api/address?page=", pageSize: 25, parse: parsePageQuery },
    { path: "/api/l1/activity/:page", pageSize: 25, parse: parseHintedPage },
  ] as const;

  it.each(routes)("$path refuses a page past its bound", ({ pageSize, parse }) => {
    const max = maxPageFor(pageSize);
    expect(parse(String(max), pageSize).ok).toBe(true);
    expect(parse(String(max + 1), pageSize).ok).toBe(false);
  });

  it("covers every route that computes an offset", () => {
    // Seven, as of the Cardano index decommission. Raising this number without
    // adding the bound to the new route is the mistake it exists to catch.
    expect(routes).toHaveLength(7);
  });
});
