import { prisma } from "../db";
import { indexerPrisma } from "../indexer/db";
import { logger } from "../logger";

/** Say out loud which databases we actually connected to, at boot.
 *
 * The explorer spent weeks reading `midgard_phase4_process_txcoverage`, a
 * test-coverage database nobody writes to, and reported every L2 figure on the
 * overview from it: 6 blocks, 21 transactions, a tip 79 hours old. The live
 * node had 1 block. Nothing failed, because a wrong database answers every
 * query perfectly. The bug lived in a gitignored .env, so it appeared in no
 * diff and no review, and it followed the working tree onto every branch.
 *
 * This asks POSTGRES what it is rather than echoing the configured URL. The
 * URL is assembled from ${VAR} expansion and is exactly the thing under
 * suspicion; printing it back would only confirm we can read our own config.
 *
 * The newest record is logged beside the name on purpose. A database name
 * alone is easy to skim past, but "connected to X, newest block is three weeks
 * old" is the sentence that makes someone look.
 *
 * Credentials are never logged. Only the database name and a freshness marker.
 */
export async function reportDatabaseIdentity(): Promise<void> {
  try {
    const [row] = await prisma.$queryRaw<
      Array<{ db: string; blocks: bigint; latest: Date | null }>
    >`
      SELECT current_database() AS db,
             (SELECT COUNT(DISTINCT header_hash) FROM blocks)::bigint AS blocks,
             (SELECT MAX(time_stamp_tz) FROM blocks) AS latest;`;
    logger.info(
      `Node database: "${row?.db}" (read-only) with ${row?.blocks ?? 0} blocks, ` +
        `newest ${row?.latest ? row.latest.toISOString() : "none"}`,
    );
  } catch (err) {
    logger.error(`Could not identify the node database: ${String(err)}`);
  }

  try {
    const [row] = await indexerPrisma.$queryRaw<Array<{ db: string }>>`
      SELECT current_database() AS db;`;
    const txs = await indexerPrisma.l1Tx.count();
    logger.info(`Explorer database: "${row?.db}" (read-write) with ${txs} indexed L1 transactions`);
  } catch (err) {
    logger.error(`Could not identify the explorer database: ${String(err)}`);
  }
}
