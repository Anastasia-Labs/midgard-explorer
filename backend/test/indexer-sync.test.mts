import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { indexerPrisma } from "../src/indexer/db.js";
import { deleteFromBlockHeight } from "../src/indexer/ingest.js";
import { getSyncCursor } from "../src/indexer/db.js";
import { parseTxInfo } from "../src/indexer/koios.js";
import { syncOnce, warnOnPreDeploymentActivity } from "../src/indexer/sync.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/**
 * The loop is exercised with injected fetchers so it never touches the network.
 * The reorg case is the one worth the setup: a block that vanishes from the
 * chain must take its rows with it, or the explorer keeps serving a
 * transaction that no longer exists.
 */

const load = (n: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/koios/${n}`, import.meta.url), "utf8"),
  );

const addressTxs = load("address-txs.json");
// Parsed exactly as the real fetchTxInfo parses it. Injecting the raw file
// instead fed writeTxDetail shapes Koios never reaches it with: this
// transaction's collateral_output carries asset_list as the string "[]", which
// only becomes an array at the Zod boundary.
const txInfo = parseTxInfo(load("tx-info-state-queue.json"));

let reachable = false;

/** Bounded probe. A stopped container on WSL2 black-holes TCP rather than
 * refusing it, so an unguarded query hangs past Vitest's hook timeout and the
 * suite reports FAIL instead of skipping. The race turns that into a clean
 * negative. */
async function probe(): Promise<void> {
  await Promise.race([
    indexerPrisma.$queryRaw`SELECT 1;`,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("probe timed out after 3000ms")), 3000),
    ),
  ]);
}

beforeAll(async () => {
  try {
    await probe();
    reachable = true;
    await truncateL1();
    await indexerPrisma.syncCursor.deleteMany({ where: { source: "l1" } });
  } catch (err) {
    console.warn(`Skipping: indexer Postgres unreachable. ${String(err)}`);
  }
});

afterAll(async () => {
  if (reachable) {
    await truncateL1();
    await indexerPrisma.syncCursor.deleteMany({ where: { source: "l1" } });
    await indexerPrisma.$disconnect();
  }
});

describe("syncOnce", () => {
  it("ingests and advances the cursor", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const r = await syncOnce({
      fetchAddressTxs: async () => addressTxs,
      fetchTxInfo: async () => txInfo,
      // The deployment sweep reaches Koios. Stubbed empty so these tests
      // stay hermetic; sweep behaviour is covered in its own test.
      fetchPolicyAssets: async () => [],
      fetchAssetTxs: async () => [],
    });
    expect(r.ingested).toBeGreaterThanOrEqual(1);
    const cursor = await getSyncCursor("l1");
    expect(cursor?.lastBlockHeight).toBeGreaterThan(0);
  });

  it("adds no duplicates on a second run", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const deps = {
      fetchAddressTxs: async () => addressTxs,
      fetchTxInfo: async () => txInfo,
    };
    await syncOnce(deps);
    const before = await indexerPrisma.l1Tx.count();
    await syncOnce(deps);
    expect(await indexerPrisma.l1Tx.count()).toBe(before);
  });

  it("removes rows for a block whose hash changed", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await syncOnce({
      fetchAddressTxs: async () => addressTxs,
      fetchTxInfo: async () => txInfo,
      // The deployment sweep reaches Koios. Stubbed empty so these tests
      // stay hermetic; sweep behaviour is covered in its own test.
      fetchPolicyAssets: async () => [],
      fetchAssetTxs: async () => [],
    });
    expect(await indexerPrisma.l1Tx.count()).toBeGreaterThan(0);

    // Chain now reports nothing at those heights: the block was rolled back.
    await syncOnce({
      fetchAddressTxs: async () => [],
      fetchTxInfo: async () => [],
      // The deployment sweep reaches Koios. Stubbed empty so these tests
      // stay hermetic; sweep behaviour is covered in its own test.
      fetchPolicyAssets: async () => [],
      fetchAssetTxs: async () => [],
    });
    expect(await indexerPrisma.l1Tx.count()).toBe(0);
  });

  it("does not move the cursor backwards when the window is empty", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await syncOnce({
      fetchAddressTxs: async () => addressTxs,
      fetchTxInfo: async () => txInfo,
      // The deployment sweep reaches Koios. Stubbed empty so these tests
      // stay hermetic; sweep behaviour is covered in its own test.
      fetchPolicyAssets: async () => [],
      fetchAssetTxs: async () => [],
    });
    const advanced = (await getSyncCursor("l1"))!.lastBlockHeight;
    expect(advanced).toBeGreaterThan(0);

    await syncOnce({
      fetchAddressTxs: async () => [],
      fetchTxInfo: async () => [],
      // The deployment sweep reaches Koios. Stubbed empty so these tests
      // stay hermetic; sweep behaviour is covered in its own test.
      fetchPolicyAssets: async () => [],
      fetchAssetTxs: async () => [],
    });
    const after = (await getSyncCursor("l1"))!.lastBlockHeight;
    expect(after).toBe(advanced);
  });

  it("surfaces a fetch failure rather than corrupting the cursor", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const before = await getSyncCursor("l1");
    await expect(
      syncOnce({
        fetchAddressTxs: async () => {
          throw new Error("Koios 503");
        },
        fetchTxInfo: async () => [],
        // The deployment sweep reaches Koios. Stubbed empty so these tests
        // stay hermetic; sweep behaviour is covered in its own test.
        fetchPolicyAssets: async () => [],
        fetchAssetTxs: async () => [],
      }),
    ).rejects.toThrow(/503/);
    const after = await getSyncCursor("l1");
    expect(after?.lastBlockHeight).toBe(before?.lastBlockHeight);
  });
});

/**
 * The stub exclusion in manifest.ts is structural. This is the empirical
 * cross-check: activity predating the deployment means the address is shared
 * with something that is not Midgard.
 */
describe("warnOnPreDeploymentActivity", () => {
  it("flags a validator with activity older than the manifest", async () => {
    const flagged = await warnOnPreDeploymentActivity({
      // 2025-10-08, nine months before the 2026-07-15 deployment.
      fetchAddressTxs: async () => [
        {
          tx_hash: "a".repeat(64),
          epoch_no: 200,
          block_height: 4000000,
          block_time: 1759939000,
        },
      ],
    });
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("flags nothing when all activity postdates the deployment", async () => {
    const flagged = await warnOnPreDeploymentActivity({
      // 2026-07-26, after the deployment.
      fetchAddressTxs: async () => [
        {
          tx_hash: "b".repeat(64),
          epoch_no: 303,
          block_height: 4980661,
          block_time: 1785058369,
        },
      ],
    });
    expect(flagged).toEqual([]);
  });

  it("flags nothing for an address with no history", async () => {
    const flagged = await warnOnPreDeploymentActivity({
      fetchAddressTxs: async () => [],
    });
    expect(flagged).toEqual([]);
  });
});
