import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import { syncOnce } from "../src/indexer/sync.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/** Reference scripts are published to the DEPLOYER'S OWN WALLET address, so
 * none of their outputs sit at a Midgard validator address and no amount of
 * address scanning will ever find them. Measured on preprod 2026-08-07: ten
 * such transactions in blocks 4939783 to 4939818, while the address scan's
 * earliest hit was block 4939843. They were missing from the explorer
 * entirely. They are reachable only through the auth token each one carries.
 */
const DEPLOY_TX = "d".repeat(64);

async function setCursor(height: number): Promise<void> {
  await indexerPrisma.syncCursor.upsert({
    where: { source: "l1" },
    create: { source: "l1", lastBlockHeight: height },
    update: { lastBlockHeight: height },
  });
}

/** Records which transaction hashes the sync decided to fetch, which is the
 * thing under test: whether the sweep widened the scan set. */
function spyDeps(sweepCalls: string[], requested: string[][]) {
  return {
    fetchAddressTxs: async () => [],
    fetchTxInfo: async (hashes: string[]) => {
      requested.push(hashes);
      return [];
    },
    fetchPolicyAssets: async (policy: string) => {
      sweepCalls.push(policy);
      return ["4465706f7369745370656e64"];
    },
    fetchAssetTxs: async () => [
      { tx_hash: DEPLOY_TX, block_height: 4939807, block_time: 1_752_600_043, epoch_no: 303 },
    ],
  } as never;
}

describe("reference script deployment sweep", () => {
  beforeEach(async () => {
    await truncateL1();
    await indexerPrisma.syncCursor.deleteMany({});
  });
  afterAll(async () => {
    await truncateL1();
    await indexerPrisma.syncCursor.deleteMany({});
    await indexerPrisma.$disconnect();
  });

  it("finds deployment transactions the address scan cannot see", async () => {
    const sweepCalls: string[] = [];
    const requested: string[][] = [];
    await setCursor(0);

    await syncOnce(spyDeps(sweepCalls, requested));

    expect(sweepCalls).toHaveLength(1);
    // The address scan returned nothing, so this hash can only have come from
    // the sweep.
    expect(requested.flat()).toContain(DEPLOY_TX);
  });

  // The discriminating case. A sweep that ran every tick would pass the test
  // above and would also spend dozens of Koios calls a minute re-learning the
  // same immutable answer, on an API that rate limits.
  it("does not sweep on an incremental pass, only on a full history scan", async () => {
    const sweepCalls: string[] = [];
    const requested: string[][] = [];
    await setCursor(4_980_661);

    await syncOnce(spyDeps(sweepCalls, requested));

    expect(sweepCalls).toHaveLength(0);
    expect(requested.flat()).not.toContain(DEPLOY_TX);
  });

  it("keeps the address scan's results when the sweep fails", async () => {
    const requested: string[][] = [];
    await setCursor(0);

    await syncOnce({
      fetchAddressTxs: async () => [
        { tx_hash: "a".repeat(64), block_height: 4980661, block_time: 1_753_500_000, epoch_no: 303 },
      ],
      fetchTxInfo: async (hashes: string[]) => {
        requested.push(hashes);
        return [];
      },
      // Koios rate limits. A failed sweep must not discard the address scan,
      // which is the bulk of the data.
      fetchPolicyAssets: async () => {
        throw new Error("Koios 429 rate limited");
      },
      fetchAssetTxs: async () => [],
    } as never);

    expect(requested.flat()).toContain("a".repeat(64));
  });
});
