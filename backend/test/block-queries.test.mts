import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import {
  getBlock,
  getBlockHashByHeight,
  getBlocksPage,
  getLastBlocks,
  getTotalBlocks,
} from "../src/db/block.js";
import { getTxInclusion } from "../src/db/transaction.js";
import { getMetrics } from "../src/db/metrics.js";
import { getAddressHistory } from "../src/db/address.js";

/**
 * The block listing queries, run against a real Postgres.
 *
 * These exist because the frontend's fixture backend runs no SQL, so it can
 * confirm a response shape and never a query. Two defects lived behind that
 * gap until the explorer was pointed at a real node on 2026-08-07:
 *
 *   1. `getLastBlocks` selected `MIN(b.tx_id)` over a `bytea` column. Postgres
 *      has no `min(bytea)`, so the overview's recent-blocks panel returned 500
 *      against every real node while the fixture answered it happily.
 *   2. Both listings grouped by `(height, header_hash)`. `blocks.height` is an
 *      autoincrement row id over block-transaction pairs, not a block height,
 *      so a block holding six transactions became six one-transaction blocks,
 *      while `total` counted distinct hashes. The page claimed six blocks and
 *      rendered twenty-one.
 *
 * Skipped, with the reason printed, when no database is reachable: this suite
 * is meant to run where the node's Postgres is, and a hard failure elsewhere
 * would make it noise rather than a gate.
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

describe("block listings against a real database", () => {
  it("answers the recent-blocks query at all", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    // The whole of defect 1: an invalid aggregate made this throw, and nothing
    // downstream of it could distinguish that from an empty chain.
    await expect(getLastBlocks(5)).resolves.toBeInstanceOf(Array);
  });

  it("returns one row per block, never one per transaction", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const rows = await getLastBlocks(50);
    const hashes = rows.map((r) => Buffer.from(r.header_hash).toString("hex"));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("counts the transactions in each block rather than reporting one", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const rows = await getLastBlocks(50);
    if (rows.length === 0) return void console.warn("skipped: no blocks on this node");
    const pairs = await prisma.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT COUNT(*)::bigint AS n FROM blocks;`;
    const total = Number(pairs[0]?.n ?? 0n);
    const counted = rows.reduce((sum, r) => sum + Number(r.tx_count), 0);
    // Only equal when the window covers every block, which 50 does here. The
    // point is that the counts add up to the block-transaction pairs that
    // exist, not to the number of blocks.
    if (rows.length < 50) expect(counted).toBe(total);
    expect(counted).toBeGreaterThanOrEqual(rows.length);
  });

  it("agrees with its own total, so pagination describes the rows it returns", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const { rows, total } = await getBlocksPage(1);
    expect(rows.length).toBeLessThanOrEqual(total);
    expect(total).toBe(await getTotalBlocks());
  });

  it("gives the recent panel and the list page the same view of a block", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const recent = await getLastBlocks(5);
    const { rows } = await getBlocksPage(1);
    if (recent.length === 0 || rows.length === 0) {
      return void console.warn("skipped: no blocks on this node");
    }
    const first = recent[0]!;
    const same = rows.find(
      (r) =>
        Buffer.from(r.header_hash).toString("hex") ===
        Buffer.from(first.header_hash).toString("hex"),
    );
    expect(same).toBeDefined();
    expect(Number(same!.tx_count)).toBe(Number(first.tx_count));
    expect(same!.height).toBe(first.height);
  });
});

describe("one block, one number", () => {
  it("gives a transaction the height of its block, not its own row id", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const blocks = await getLastBlocks(50);
    const multi = blocks.find((b) => Number(b.tx_count) > 1);
    if (!multi) return void console.warn("skipped: no multi-transaction block on this node");

    const hash = Buffer.from(multi.header_hash).toString("hex");
    const txs = await prisma.$queryRaw<
      Array<{ tx_id: Uint8Array }>
    >`SELECT tx_id FROM blocks WHERE header_hash = ${Buffer.from(hash, "hex")};`;

    // Every transaction in the block must report the block's height. Reporting
    // its own row id made the journey say "#21" for a block the list called
    // "#20", which is the same block under two names.
    for (const t of txs) {
      const inclusion = await getTxInclusion(Buffer.from(t.tx_id).toString("hex"));
      expect(inclusion).not.toBeNull();
      expect(inclusion!.height).toBe(multi.height);
    }
  });

  it("resolves that height back to the same block", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const blocks = await getLastBlocks(5);
    if (blocks.length === 0) return void console.warn("skipped: no blocks on this node");
    for (const b of blocks) {
      const hash = await getBlockHashByHeight(b.height);
      expect(hash).not.toBeNull();
      expect(Buffer.from(hash!).toString("hex")).toBe(
        Buffer.from(b.header_hash).toString("hex"),
      );
    }
  });
});

describe("the chain tip", () => {
  it("reports the tip block's height, not the newest transaction's row id", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const metrics = await getMetrics();
    const blocks = await getLastBlocks(1);
    if (blocks.length === 0) return void console.warn("skipped: no blocks on this node");
    // The panel said "chain tip #21" while the list under it said #20. Same
    // block, two numbers, and a reader has no way to tell which is the chain.
    expect(metrics.tip.height).toBe(blocks[0]!.height);
  });
});

describe("the block page", () => {
  it("labels a block with one height on every row", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const blocks = await getLastBlocks(50);
    const multi = blocks.find((b) => Number(b.tx_count) > 1);
    if (!multi) return void console.warn("skipped: no multi-transaction block on this node");
    const rows = await getBlock(Buffer.from(multi.header_hash).toString("hex"));
    // The page took its title from the first row, so a two-transaction block
    // was headed "#21" while every list called it "#20".
    expect(new Set(rows.map((r) => r.height))).toEqual(new Set([multi.height]));
  });
});

/* NOT COVERED, stated rather than faked.
 *
 * `getAddressHistory` reports the block height per row and was fixed with the
 * others on 2026-08-07. A guard for it was attempted four ways and each one
 * passed against the reverted bug, so none of them tested anything: inside this
 * file the history rows come back with no header hash to compare, while the
 * same call in a standalone file returns them. The cause was not found.
 *
 * Rather than keep an assertion that cannot fail, the gap is recorded here. The
 * fix itself was verified by observation: the address page rendered "#21" for a
 * block every listing called "#20", and the API returned height 20 for that row
 * afterwards. Anyone picking this up should start by finding out why
 * `getAddressHistory` behaves differently in this file.
 */
