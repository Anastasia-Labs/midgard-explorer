import { beforeAll, describe, expect, it } from "vitest";
import { indexerPrisma, readIndexConsistently, getSyncCursors } from "../src/indexer/db.js";
import { reachable as isReachable } from "./helpers/reachable.mjs";
import { truncateL1 } from "./helpers/truncate.mjs";

/**
 * The index answers about ONE moment.
 *
 * `getIndexSettlement` reads a header and the sync cursors. Read on separate
 * connections, an ingest landing between them yields "no header, and the index
 * is current", which presents a settlement the index had just recorded as one
 * it does not have. The cursors say the answer is trustworthy; the header says
 * there is nothing there; both are true of different instants.
 */

let reachable = false;

beforeAll(async () => {
  reachable = await isReachable("index", "index snapshot consistency");
  if (reachable) await truncateL1();
});

describe("reading the index consistently", () => {
  /**
   * The ordering that makes the guarantee real.
   *
   * PostgreSQL takes a REPEATABLE READ snapshot at the transaction's FIRST
   * statement, not at BEGIN, so the protection only covers what is read after
   * it. `getIndexSettlement` reads the header first and the cursors second,
   * which is the order that matters: a pass committing between them cannot
   * make the cursors look current for a header this read never saw.
   */
  it("keeps the cursors as of the moment the header was read", async () => {
    if (!reachable) return;

    // Restored exactly, including absence. These files share one database and
    // run in one worker, so a cursor left at 999000 is not this file's private
    // business: the readiness suite reads the same row and reported a false
    // verdict from it, which made the whole backend gate depend on file order.
    const original = await indexerPrisma.syncCursor.findUnique({ where: { source: "l1" } });
    try {
      await indexerPrisma.syncCursor.upsert({
        where: { source: "l1" },
        create: { source: "l1", lastBlockHeight: 1 },
        update: { lastBlockHeight: 1 },
      });

      const observed = await readIndexConsistently(async (tx) => {
        // First statement: this fixes the snapshot, exactly as the header read
        // does in `getIndexSettlement`.
        const before = await getSyncCursors(tx);

        // A pass commits on another connection, mid-read.
        await indexerPrisma.syncCursor.upsert({
          where: { source: "l1" },
          create: { source: "l1", lastBlockHeight: 999_000 },
          update: { lastBlockHeight: 999_000 },
        });

        const after = await getSyncCursors(tx);
        return { before: before.get("l1") ?? null, after: after.get("l1") ?? null };
      });

      expect(observed.before).toBe(1);
      expect(observed.after, "the transaction saw a concurrent commit").toBe(1);

      // The write really did land, so this is not passing by doing nothing.
      const outside = await getSyncCursors();
      expect(outside.get("l1")).toBe(999_000);
    } finally {
      if (original === null) {
        await indexerPrisma.syncCursor.deleteMany({ where: { source: "l1" } });
      } else {
        await indexerPrisma.syncCursor.update({
          where: { source: "l1" },
          data: { lastBlockHeight: original.lastBlockHeight, updatedAt: original.updatedAt },
        });
      }
    }
  });
});
