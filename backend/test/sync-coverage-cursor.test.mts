import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { reachable as isReachable } from "./helpers/reachable.mjs";
import { indexerPrisma, getSyncCursors, SYNC_SOURCES } from "../src/indexer/db.js";
import { syncOnce, type SyncDeps } from "../src/indexer/sync.js";
import { resetSyncCursors, truncateL1 } from "./helpers/truncate.mjs";

/**
 * The cursor records what the index COVERS, not where its newest Midgard row is.
 *
 * It used to record the latter, seeded from the previous cursor, so an empty
 * scan left it exactly where it was. Three states then produced one number:
 * the indexer running with activity, the indexer running on a quiet chain, and
 * the indexer stopped. A freshness check built on it could not tell them apart,
 * and the interface reported "the index is current" for a cursor that had not
 * moved in a day.
 *
 * The pass now samples the provider tip before scanning and advances to it once
 * every source completes, which is what makes a lag figure mean something.
 */

const TIP = 5_000_000;

let reachable = false;

const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({
  // No Midgard activity anywhere. This is the quiet chain the old cursor could
  // not distinguish from a stopped writer.
  fetchAddressTxs: async () => [],
  fetchTxInfo: async () => [],
  fetchPolicyAssets: async () => [],
  fetchAssetTxs: async () => [],
  fetchAccountUpdates: async () => [],
  fetchEpochParams: async () => null,
  fetchTip: async () => ({ blockHeight: TIP, blockTime: 1_700_000_000 }),
  ...over,
});

beforeAll(async () => {
  reachable = await isReachable("index", "coverage cursor");
});

afterEach(async () => {
  if (!reachable) return;
  await truncateL1();
  // Coverage is the thing under test here, so it must not survive into the
  // next case. `truncateL1` keeps cursors on purpose, which is right for the
  // reorg tests and wrong for these.
  await resetSyncCursors();
});

describe("a completed pass records coverage", () => {
  it("advances every cursor to the sampled tip even when nothing was found", async () => {
    if (!reachable) return;
    const result = await syncOnce(deps());
    expect(result.reconciled).toBe(true);
    expect(result.ingested).toBe(0);

    const cursors = await getSyncCursors();
    for (const source of SYNC_SOURCES) {
      expect(cursors.get(source), `${source} did not record coverage`).toBe(TIP);
    }
  });

  /** All three are written in one transaction from one sampled height, so they
   * cannot describe different windows. Readiness rejects them when they do. */
  it("moves all three sources to the same height", async () => {
    if (!reachable) return;
    await syncOnce(deps());
    const heights = new Set((await getSyncCursors()).values());
    expect(heights.size).toBe(1);
  });
});

describe("a pass that could not establish coverage claims none", () => {
  /** A tip that cannot be read is not fatal: whatever was found is still
   * written, because every write is an upsert and adding rows cannot lose any.
   * The pass simply does not claim a coverage height it has no evidence for. */
  it("does not invent a height when the tip is unavailable", async () => {
    if (!reachable) return;
    const cursors = await syncOnce(
      deps({
        fetchTip: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).then(() => getSyncCursors());

    for (const source of SYNC_SOURCES) {
      expect(cursors.get(source) ?? 0).toBe(0);
    }
  });

  /** A source that did not complete blocks the whole advance, because the
   * window was not fully covered and the reorg rewrite must not run on it. */
  it("does not advance when a source failed", async () => {
    if (!reachable) return;
    await syncOnce(
      deps({
        fetchPolicyAssets: async () => {
          throw new Error("policy scan failed");
        },
      }),
    );
    const cursors = await getSyncCursors();
    for (const source of SYNC_SOURCES) {
      expect(cursors.get(source) ?? 0).toBe(0);
    }
  });
});
