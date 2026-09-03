import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { reachable as isReachable } from "./helpers/reachable.mjs";
import { readFileSync } from "node:fs";
import { config } from "../src/indexer/../config.js";
import { getSyncCursor, indexerPrisma, setSyncCursor } from "../src/indexer/db.js";
import { parseTxInfo, type KoiosAddressTx } from "../src/indexer/koios.js";
import { syncOnce, type SyncDeps } from "../src/indexer/sync.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/**
 * Reorg reconciliation, which used to delete rows no source would fetch back.
 *
 * Each source kept its own cursor and scanned from it, while the delete used
 * the primary cursor's floor. With every cursor at 100 and a lookback of 20,
 * one pass deleted everything from height 80 and then asked the mint scan for
 * transactions above 100. A mint-only transaction at height 90 was erased and
 * never requested again: not stale, gone, and no later pass could recover it
 * because the mint cursor had already moved past it.
 *
 * The stubs below behave like Koios rather than ignoring their arguments: each
 * returns only what sits above the height it was asked for. A scan that asks
 * from the wrong floor therefore returns nothing, exactly as it did on preprod.
 */

const SOURCES = ["l1", "l1:mints", "l1:rewards"];

const template = parseTxInfo(
  JSON.parse(
    readFileSync(new URL("./fixtures/koios/tx-info-state-queue.json", import.meta.url), "utf8"),
  ),
)[0];

/** A transaction at a chosen height, otherwise a copy of a real one. */
const txAt = (hash: string, height: number) => ({
  ...template,
  tx_hash: hash,
  block_hash: hash,
  block_height: height,
});

const rowFor = (info: { tx_hash: string; block_height: number }): KoiosAddressTx => ({
  tx_hash: info.tx_hash,
  epoch_no: template.epoch_no,
  block_height: info.block_height,
  block_time: template.tx_timestamp,
});

const ADDRESS_TX = txAt("a".repeat(64), 100);
const MINT_ONLY_TX = txAt("b".repeat(64), 90);

/** Every fetcher, each honouring the floor it is asked for. */
const koiosLike = (over: Partial<SyncDeps> = {}): SyncDeps => ({
  fetchAddressTxs: async (_addresses, after) =>
    [rowFor(ADDRESS_TX)].filter((r) => r.block_height > after),
  fetchAssetTxs: async (_policy, _name, after = 0) =>
    [rowFor(MINT_ONLY_TX)].filter((r) => r.block_height > after),
  fetchPolicyAssets: async () => ["4d494447415244"],
  fetchTxInfo: async (hashes) =>
    [ADDRESS_TX, MINT_ONLY_TX].filter((t) => hashes.includes(t.tx_hash)),
  fetchAccountUpdates: async () => [],
  fetchEpochParams: async () => null,
  // Injected so no test reaches the network. This fixture chain's own newest
  // block, so the reorg window still covers it: the floor now tracks the
  // chain tip rather than the newest Midgard row.
  fetchTip: async () => ({ blockHeight: 100, blockTime: 1_700_000_000 }),
  ...over,
});

let reachable = false;

const clear = async () => {
  await truncateL1();
  await indexerPrisma.syncCursor.deleteMany({
    where: { source: { in: SOURCES } },
  });
};

beforeAll(async () => {
  reachable = await isReachable("index", "reconciliation");
});

beforeEach(async () => {
  if (reachable) await clear();
});

afterAll(async () => {
  if (reachable) {
    await clear();
    await indexerPrisma.$disconnect();
  }
});

const cursors = async () =>
  Object.fromEntries(
    await Promise.all(
      SOURCES.map(async (s) => [s, (await getSyncCursor(s))?.lastBlockHeight ?? 0]),
    ),
  );

describe("reorg reconciliation", () => {
  it("keeps a mint-only transaction that sits inside the reorg window", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    await syncOnce(koiosLike());
    expect(await indexerPrisma.l1Tx.count()).toBe(2);

    // Both cursors now sit above the mint-only transaction, which is the state
    // that used to make it unrecoverable: the window from 80 was deleted while
    // the mint scan asked from 100.
    const after = await cursors();
    expect(after["l1"]).toBe(100);
    expect(after["l1:mints"]).toBe(100);
    expect(config.L1_REORG_LOOKBACK_BLOCKS).toBeGreaterThan(0);

    await syncOnce(koiosLike());

    const survived = await indexerPrisma.l1Tx.findUnique({
      where: { txHash: MINT_ONLY_TX.tx_hash },
    });
    expect(survived).not.toBeNull();
    expect(await indexerPrisma.l1Tx.count()).toBe(2);
  });

  it("does not delete the window when the policy scan fails", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    await syncOnce(koiosLike());
    expect(await indexerPrisma.l1Tx.count()).toBe(2);
    const before = await cursors();

    // A failed source used to log and carry on into the same destructive
    // rewrite, dropping the rows only that source could see.
    const result = await syncOnce(
      koiosLike({
        fetchAssetTxs: async () => {
          throw new Error("Koios 503");
        },
      }),
    );

    expect(result.reconciled).toBe(false);
    expect(await indexerPrisma.l1Tx.count()).toBe(2);
    expect(await cursors()).toEqual(before);
  });

  it("does not delete the window when the reward scan fails", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    await syncOnce(koiosLike());
    const before = await cursors();

    const result = await syncOnce(
      koiosLike({
        fetchAccountUpdates: async () => {
          throw new Error("Koios 503");
        },
      }),
    );

    expect(result.reconciled).toBe(false);
    expect(await indexerPrisma.l1Tx.count()).toBe(2);
    expect(await cursors()).toEqual(before);
  });

  it("still ingests what it found while a source is failing", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    // Freshness must not wait on reconciliation: every write is an upsert, so
    // adding rows without clearing the window cannot lose any.
    const result = await syncOnce(
      koiosLike({
        fetchAccountUpdates: async () => {
          throw new Error("Koios 503");
        },
      }),
    );
    expect(result.reconciled).toBe(false);
    expect(await indexerPrisma.l1Tx.count()).toBe(2);
  });

  it("removes a transaction that vanished from the chain", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    await syncOnce(koiosLike());
    expect(await indexerPrisma.l1Tx.count()).toBe(2);

    // The chain now reports nothing at those heights.
    await syncOnce(
      koiosLike({
        fetchAddressTxs: async () => [],
        fetchAssetTxs: async () => [],
        fetchTxInfo: async () => [],
      }),
    );
    expect(await indexerPrisma.l1Tx.count()).toBe(0);
  });

  it("advances every cursor to the same confirmed height", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    await syncOnce(koiosLike());
    const after = await cursors();
    expect(new Set(Object.values(after)).size).toBe(1);
  });

  it("never lets a source cursor run ahead of the delete floor", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    // The exact shape of the original defect: the mint source is left behind
    // while the primary races ahead. The floor is the minimum of the two, so
    // the window that gets deleted is one the mint scan has also read.
    await setSyncCursor("l1", 100_000);
    await setSyncCursor("l1:mints", 100);
    await setSyncCursor("l1:rewards", 100_000);

    const asked: number[] = [];
    await syncOnce(
      koiosLike({
        fetchAddressTxs: async (_a, after) => {
          asked.push(after);
          return [];
        },
        fetchAssetTxs: async (_p, _n, after = 0) => {
          asked.push(after);
          return [];
        },
      }),
    );

    const floor = 100 - config.L1_REORG_LOOKBACK_BLOCKS;
    expect(new Set(asked)).toEqual(new Set([floor]));
  });
});
