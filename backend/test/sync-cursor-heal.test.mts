import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import { healCursorIfDataWasWiped } from "../src/indexer/sync.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/** The failure this guards against: a migration deleted every l1_tx row but
 * left sync_cursor near chain tip, so each pass scanned a 20 block window,
 * found nothing, wrote nothing, and logged success. The explorer served an
 * empty page and reported itself healthy.
 *
 * The dangerous fix would be to rescan whenever a scan comes back empty, which
 * is ordinary and would trigger full-history refetches constantly. The signal
 * used here is narrower: syncOnce only advances the cursor to the height of
 * rows it actually found, so a non-zero cursor proves rows once existed. An
 * empty TABLE under a non-zero cursor is therefore a contradiction, not a
 * quiet period.
 */
async function setCursor(height: number): Promise<void> {
  await indexerPrisma.syncCursor.upsert({
    where: { source: "l1" },
    create: { source: "l1", lastBlockHeight: height },
    update: { lastBlockHeight: height },
  });
}

const readCursor = async () =>
  (await indexerPrisma.syncCursor.findUnique({ where: { source: "l1" } }))?.lastBlockHeight;

/** A valid row, so nothing except the condition under test can reject it. */
async function insertTx(txHash: string, blockHeight: number): Promise<void> {
  await indexerPrisma.l1Tx.create({
    data: {
      txHash,
      blockHeight,
      blockHash: "b".repeat(64),
      slot: 5000,
      epoch: 7,
      txTime: new Date(1_760_000_000_000),
      fee: 560587n,
      size: 2003,
      totalOutput: 2698705507n,
      blockIndex: 9,
      certDeposit: 0n,
    },
  });
}

describe("healCursorIfDataWasWiped", () => {
  beforeEach(async () => {
    await truncateL1();
    await indexerPrisma.syncCursor.deleteMany({});
  });
  afterAll(async () => {
    await truncateL1();
    await indexerPrisma.syncCursor.deleteMany({});
    await indexerPrisma.$disconnect();
  });

  it("resets a cursor that points near tip while the table is empty", async () => {
    await setCursor(4980661);
    expect(await healCursorIfDataWasWiped()).toBe(true);
    expect(await readCursor()).toBe(0);
  });

  // The discriminating case. A heal that always fires would pass the test
  // above and would also throw away a healthy cursor on every restart, making
  // the explorer refetch the whole chain each boot.
  it("leaves the cursor alone when the table still holds transactions", async () => {
    await setCursor(4980661);
    await insertTx("a".repeat(64), 4980661);
    expect(await healCursorIfDataWasWiped()).toBe(false);
    expect(await readCursor()).toBe(4980661);
  });

  it("does nothing when the cursor is already at genesis", async () => {
    await setCursor(0);
    expect(await healCursorIfDataWasWiped()).toBe(false);
    expect(await readCursor()).toBe(0);
  });

  it("does nothing on a first run, when no cursor row exists yet", async () => {
    expect(await healCursorIfDataWasWiped()).toBe(false);
    expect(await readCursor()).toBeUndefined();
  });
});
