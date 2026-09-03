import { indexerPrisma } from "../../src/indexer/db.js";

/** Test cleanup must be total. `deleteFromBlockHeight` is a production
 * reconciliation primitive: by design it never touches rows whose blockHeight
 * is null, which is exactly what carried-forward headers are. Reusing it as
 * test teardown leaves residue that has already produced one false pass.
 *
 * The detail tables cascade from l1_tx, but they are deleted explicitly
 * anyway: a test helper that depends on a schema-level cascade breaks
 * silently the day someone drops the constraint.
 */
export async function truncateL1(): Promise<void> {
  await indexerPrisma.l1TxAsset.deleteMany({});
  await indexerPrisma.l1Redeemer.deleteMany({});
  await indexerPrisma.l1TxIo.deleteMany({});
  await indexerPrisma.l1BlockHeader.deleteMany({});
  await indexerPrisma.l1Event.deleteMany({});
  await indexerPrisma.l1Tx.deleteMany({});
  await indexerPrisma.l1ProtocolParams.deleteMany({});
}

/** The cursors, which `truncateL1` deliberately leaves alone.
 *
 * Emptying the tables and resetting coverage are different questions: a reorg
 * test wants the rows gone and the cursor kept, and a coverage test wants both
 * gone. Kept separate so neither has to work around the other, and exported
 * rather than written inline because a second copy of it in one more test file
 * is how the two drift apart.
 */
export async function resetSyncCursors(): Promise<void> {
  await indexerPrisma.syncCursor.deleteMany({});
}
