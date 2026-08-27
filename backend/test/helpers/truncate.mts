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
