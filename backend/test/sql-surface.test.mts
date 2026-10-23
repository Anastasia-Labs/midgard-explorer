import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import {
  getBlockDaMetadata,
  getBlockEvents,
  getBlockFinalization,
  getBlockNeighbours,
  getLastBlocks,
  getLastTransactions,
} from "../src/db/block.js";
import {
  getTotalTransactions,
  getTransaction,
  getTransactionsPage,
  getTxAdmission,
  getTxLifecycle,
} from "../src/db/transaction.js";
import { getDepositsPage } from "../src/db/deposits.js";
import { getWithdrawalsPage } from "../src/db/withdrawals.js";
import { getForcedTransactionsPage } from "../src/db/forcedTransactions.js";
import { searchAddress, searchByPrefix } from "../src/db/search.js";
import { getSpendableLedger } from "../src/db/asset.js";
import { toHex } from "../src/utils.js";

/**
 * Every remaining query, executed once against a real Postgres.
 *
 * `block-queries.test.mts` covers the listings that broke on 2026-08-07. This
 * covers the rest, and exists for one reason: twenty of the forty exported
 * database functions were named in no test at all, so the only thing standing
 * between a malformed query and production was whether somebody happened to
 * open that page against a real node. Both defects found that day were of
 * exactly this shape, valid TypeScript that Postgres refuses:
 * `min()` over `bytea`, and a GROUP BY on a column that does not mean what its
 * name says.
 *
 * These assert little about the data on purpose. The node's database holds
 * whatever it holds, and a test that demanded rows would fail on an empty
 * chain, which is not a defect. What they assert is that the query runs, that
 * it returns the shape the callers destructure, and that the paging arithmetic
 * agrees with itself. A thrown `42883` or `42703` fails the test, which is the
 * whole point.
 *
 * Skipped with a printed reason where no database is reachable, matching the
 * neighbouring suite.
 */

let reachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1;`;
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

const skip = () => void console.warn("skipped: no database reachable");

/** A header hash from the chain when there is one, so the per-block queries
 * run against a row rather than only against their empty path. Both paths
 * matter: a query can be well formed for a hit and malformed for a miss. */
async function anyHeaderHash(): Promise<string | null> {
  const blocks = await getLastBlocks(1);
  const first = blocks[0];
  // The listings return `bytea` as bytes; every caller hexes it before passing
  // it back in, so the test has to take the same path a route does.
  return first ? toHex(first.header_hash) : null;
}

const ABSENT_HASH = "0".repeat(56);
const ABSENT_TX = "0".repeat(64);

describe("per-block queries", () => {
  it("runs the data-availability query for a present and an absent block", async () => {
    if (!reachable) return skip();
    const hash = await anyHeaderHash();
    if (hash) await getBlockDaMetadata(hash);
    await expect(getBlockDaMetadata(ABSENT_HASH)).resolves.not.toThrow;
  });

  it("runs the finalization and event queries", async () => {
    if (!reachable) return skip();
    const hash = await anyHeaderHash();
    await getBlockFinalization(hash ?? ABSENT_HASH);
    const events = await getBlockEvents(hash ?? ABSENT_HASH);
    // Every caller destructures these three, so a missing key is a TypeError
    // one layer up rather than a failure here.
    expect(Object.keys(events).sort()).toEqual(
      ["deposits", "forcedTransactions", "withdrawals"].sort(),
    );
  });

  it("runs the neighbour query, which reads a height that is a row id", async () => {
    if (!reachable) return skip();
    const hash = await anyHeaderHash();
    const neighbours = await getBlockNeighbours(hash ?? ABSENT_HASH);
    expect(neighbours).toHaveProperty("prev");
    expect(neighbours).toHaveProperty("next");
  });
});

describe("transaction queries", () => {
  it("runs the recent-transactions query", async () => {
    if (!reachable) return skip();
    await expect(getLastTransactions(5)).resolves.toBeInstanceOf(Array);
  });

  it("counts transactions and pages through them consistently", async () => {
    if (!reachable) return skip();
    const total = await getTotalTransactions();
    const first = await getTransactionsPage(1);
    expect(typeof total).toBe("number");
    expect(first.rows.length).toBeLessThanOrEqual(first.limit);
    // The claim the page makes about itself: more rows exist only if the count
    // says so. This is the invariant that broke when `total` counted distinct
    // hashes while the rows were per transaction.
    expect(first.hasNextPage).toBe(first.rows.length < first.total);
  });

  it("filters a page by status without changing its arithmetic", async () => {
    if (!reachable) return skip();
    const filtered = await getTransactionsPage(1, "committed");
    expect(filtered.rows.length).toBeLessThanOrEqual(filtered.limit);
    expect(filtered.total).toBeGreaterThanOrEqual(filtered.rows.length);
  });

  it("answers the admission, lifecycle and body queries for an unknown hash", async () => {
    if (!reachable) return skip();
    // The absent path is the one a stranger's URL takes, and an absent row must
    // read as absent rather than as an error.
    await expect(getTransaction(ABSENT_TX)).resolves.toBeNull();
    await getTxAdmission(ABSENT_TX);
    await getTxLifecycle(ABSENT_TX);
  });
});

describe("bridge listings", () => {
  it("pages deposits, withdrawals and forced transactions", async () => {
    if (!reachable) return skip();
    for (const page of [
      await getDepositsPage(1),
      await getWithdrawalsPage(1),
      await getForcedTransactionsPage(1),
    ]) {
      expect(page.rows.length).toBeLessThanOrEqual(page.limit);
      expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
      expect(page.hasNextPage).toBe(page.rows.length < page.total);
    }
  });

  it("filters each listing by its identifier", async () => {
    if (!reachable) return skip();
    // Hex, because the route validates that before calling, and an id that
    // matches nothing still has to produce a well formed empty page.
    const absent = "ab".repeat(16);
    expect((await getDepositsPage(1, absent)).rows).toEqual([]);
    expect((await getWithdrawalsPage(1, absent)).rows).toEqual([]);
    expect((await getForcedTransactionsPage(1, absent)).rows).toEqual([]);
  });
});

describe("search", () => {
  it("runs the prefix search over every table it spans", async () => {
    if (!reachable) return skip();
    // Long enough to pass the route's minimum, and matching nothing, so the
    // query runs to completion over each branch rather than short circuiting
    // on the first hit.
    await expect(searchByPrefix("beefbeefbeef")).resolves.toBeInstanceOf(Array);
  });

  it("runs the address search", async () => {
    if (!reachable) return skip();
    await expect(searchAddress("addr_test1" + "q".repeat(50))).resolves.toBeInstanceOf(Array);
  });
});

describe("the spendable ledger scan", () => {
  it("runs and respects its own bound", async () => {
    if (!reachable) return skip();
    const scan = await getSpendableLedger();
    expect(Array.isArray(scan.rows)).toBe(true);
    // The scan is bounded deliberately: an unbounded one is a full table read
    // on every assets request. `truncated` is how the response says so rather
    // than quietly reporting a partial holder set as the whole one.
    expect(scan.rows.length).toBeLessThanOrEqual(scan.total);
    expect(scan.truncated).toBe(scan.rows.length < scan.total);
  });
});
