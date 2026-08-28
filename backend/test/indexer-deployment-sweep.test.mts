import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getSyncCursor, indexerPrisma } from "../src/indexer/db.js";
import { syncOnce } from "../src/indexer/sync.js";
import { loadManifest } from "../src/indexer/manifest.js";
import { config } from "../src/config.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/** The mint-policy scan also enumerates assets, once per Mint entry, so a spy
 * that counts every `fetchPolicyAssets` call counts both scans. Only calls for
 * the reference-script auth policy belong to the sweep under test. */
const REFERENCE_POLICY = loadManifest(config.MIDGARD_MANIFEST_PATH)
  .referenceScriptAuthPolicy;

const sweepsOf = (calls: string[]) =>
  calls.filter((policy) => policy === REFERENCE_POLICY);

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
    // Stubbed rather than omitted. An omitted dep falls through to the real
    // implementation, so a test meant to be offline reaches live Koios and
    // fails for a reason that has nothing to do with what it asserts.
    fetchAccountUpdates: async () => [],
    fetchEpochParams: async () => null,
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

    expect(sweepsOf(sweepCalls).length).toBeGreaterThan(0);
    // The address scan returned nothing, so this hash can only have come from
    // the sweep.
    expect(requested.flat()).toContain(DEPLOY_TX);
  });

  // The discriminating case. A sweep that ran every tick would pass the test
  // above and would also spend dozens of Koios calls a minute re-learning the
  // same immutable answer, on an API that rate limits.
  //
  // Completion is now recorded durably rather than inferred from the scan
  // floor. The old gate was `scanFloor === 0`, which stops being true a few
  // blocks in, so a sweep that failed on the first pass was never retried.
  it("does not re-fetch history the policy cursor has already covered", async () => {
    await setCursor(0);
    // First pass covers the policies and records how far it got.
    await syncOnce(spyDeps([], []));

    const floors: number[] = [];
    const base = spyDeps([], []) as Record<string, unknown>;
    const second = {
      ...base,
      fetchAssetTxs: async (_p: string, _a: string, after: number) => {
        floors.push(after);
        return [];
      },
    } as never;
    await syncOnce(second);

    // The cursor moved past the deployment block, so the next pass asks Koios
    // only for what came after it rather than re-reading the whole history.
    //
    // The floor is the reconciliation floor shared by every source, not this
    // source's own cursor. Scanning from its own cursor is what let the pass
    // delete a window it had not read: the delete ran from
    // `cursor - lookback` while the policy scan asked from `cursor`, so a
    // mint-only transaction in between was erased and never requested again.
    const covered = (await getSyncCursor("l1:mints"))!.lastBlockHeight;
    expect(floors.length).toBeGreaterThan(0);
    expect(covered).toBeGreaterThan(0);
    expect(Math.min(...floors)).toBe(covered - config.L1_REORG_LOOKBACK_BLOCKS);
  });

  // The regression the durable marker exists to close: a failed sweep used to
  // be unreachable forever once ordinary activity moved the cursor.
  it("retries the sweep on the next pass when it failed", async () => {
    await setCursor(4_980_661);
    const failing = {
      ...(spyDeps([], []) as Record<string, unknown>),
      fetchPolicyAssets: async () => {
        throw new Error("Koios unavailable");
      },
    } as never;
    await syncOnce(failing);

    const sweepCalls: string[] = [];
    const requested: string[][] = [];
    await syncOnce(spyDeps(sweepCalls, requested));

    expect(sweepsOf(sweepCalls).length).toBeGreaterThan(0);
    expect(requested.flat()).toContain(DEPLOY_TX);
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
      fetchAccountUpdates: async () => [],
      fetchEpochParams: async () => null,
    } as never);

    expect(requested.flat()).toContain("a".repeat(64));
  });
});
