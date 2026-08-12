import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import { syncOnce } from "../src/indexer/sync.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/**
 * The sync must not open a hole. Two guarantees behind one boundary: nothing is
 * deleted before the network answers, and a failure part way through the write
 * leaves the previous index intact.
 *
 * Both matter most on a full rescan, where the delete covers every row the
 * explorer has. An empty index that reports success is the worst failure this
 * system can have, because nothing downstream can tell it apart from a chain
 * with no Midgard activity.
 */

const EXISTING = "1".repeat(64);

/** Bounded probe. A stopped container on WSL2 black-holes TCP rather than
 * refusing it, so an unguarded query hangs past Vitest's hook timeout and the
 * suite reports FAIL instead of skipping. */
async function probe(): Promise<void> {
  await Promise.race([
    indexerPrisma.$queryRaw`SELECT 1;`,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("probe timed out after 3000ms")), 3000),
    ),
  ]);
}

let reachable = false;

beforeEach(async () => {
  try {
    await probe();
    reachable = true;
  } catch (err) {
    console.warn(`Skipping: indexer Postgres unreachable. ${String(err)}`);
    return;
  }
  await truncateL1();
  await indexerPrisma.syncCursor.deleteMany({ where: { source: "l1" } });
  await indexerPrisma.l1Tx.create({
    data: {
      txHash: EXISTING,
      blockHeight: 10,
      blockHash: "b".repeat(64),
      slot: 1,
      epoch: 1,
      txTime: new Date(1_700_000_000_000),
      fee: 1n,
      size: 1,
      totalOutput: 1n,
      blockIndex: 0,
      certDeposit: 0n,
    },
  });
});

afterAll(async () => {
  if (!reachable) return;
  await truncateL1();
  await indexerPrisma.syncCursor.deleteMany({ where: { source: "l1" } });
  await indexerPrisma.$disconnect();
});

describe("sync atomicity", () => {
  it("still holds the previous rows while Koios is being asked", async () => {
    if (!reachable) return;
    let rowsDuringFetch = -1;
    await syncOnce({
      // A hit is required, or the loop short-circuits and never fetches.
      fetchAddressTxs: async () => [
        { tx_hash: "2".repeat(64), epoch_no: 1, block_height: 20, block_time: 1 },
      ],
      fetchPolicyAssets: async () => [],
      fetchAssetTxs: async () => [],
      fetchTxInfo: async () => {
        rowsDuringFetch = await indexerPrisma.l1Tx.count();
        return [];
      },
    }).catch(() => undefined);
    expect(rowsDuringFetch).toBe(1);
  });

  it("keeps the previous index when the fetch fails", async () => {
    if (!reachable) return;
    await expect(
      syncOnce({
        fetchAddressTxs: async () => [
          { tx_hash: "2".repeat(64), epoch_no: 1, block_height: 20, block_time: 1 },
        ],
        fetchPolicyAssets: async () => [],
        fetchAssetTxs: async () => [],
        fetchTxInfo: async () => {
          throw new Error("Koios rate limited");
        },
      }),
    ).rejects.toThrow("Koios rate limited");
    expect(await indexerPrisma.l1Tx.count()).toBe(1);
  });
});
