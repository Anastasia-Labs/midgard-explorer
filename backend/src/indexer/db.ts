import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma-indexer/indexer-client";
import { config } from "../config";
import { boundedPoolConfig } from "../db/pool";

// The database the explorer owns. Separate client from src/db.ts, which reads
// the node's Postgres and never writes to it.
const adapter = new PrismaPg(
  boundedPoolConfig({
    connectionString: config.INDEXER_POSTGRES_URL,
    max: config.INDEXER_DB_POOL_MAX,
    connectionTimeoutMs: config.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: config.DB_IDLE_TIMEOUT_MS,
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
    applicationName: "midgard-explorer-l1-indexer",
  }),
);
export const indexerPrisma = new PrismaClient({ adapter });

/** The client Prisma hands an interactive transaction. Every write helper takes
 * one so a whole sync pass commits or rolls back as a unit. */
export type IndexerTx = Omit<
  typeof indexerPrisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/** The attribution written before the ingest path passed a deployment. It is
 * never a real manifest identity, so a row carrying it is a row no query can
 * reach. */
export const UNATTRIBUTED_DEPLOYMENT = "default";

/** Per-source cursors, named here rather than in `sync.ts` so readiness can
 * read the same three without importing the network layer.
 *
 * `l1` and `l1:mints` are incremental: each records the height through which
 * that source has confirmed coverage. `l1:rewards` is not incremental, because
 * Koios `/account_updates` has no height filter; it records the height through
 * which the last COMPLETE reward scan was confirmed.
 *
 * All three are written only inside a pass that reconciled, so a non-zero value
 * is the durable record that a full pass completed. */
export const SYNC_SOURCE_PRIMARY = "l1";
export const SYNC_SOURCE_MINTS = "l1:mints";
export const SYNC_SOURCE_REWARDS = "l1:rewards";
export const SYNC_SOURCES = [
  SYNC_SOURCE_PRIMARY,
  SYNC_SOURCE_MINTS,
  SYNC_SOURCE_REWARDS,
] as const;

/** How much of the L1 chain this index actually holds.
 *
 * "unbuilt" and "indexing" are different answers to a reader, and an empty list
 * of L1 transactions cannot tell them apart on its own: an index nobody has
 * built and a chain with no activity both return nothing. The read path
 * publishes this so a page can say which it is.
 *
 * The rule is the one `probeIndexReconciled` enforces, stated once here.
 * `syncOnce` writes all three cursors in one transaction from one observed tip,
 * only in a pass where every source completed, so "reconciled" is non-zero AND
 * equal. Equality alone passes a fresh migration, where zero equals zero.
 * Non-zero alone passes three cursors written by three different passes, which
 * is an index whose sources have covered different windows.
 */
export type L1SyncState = "unbuilt" | "indexing" | "reconciled";

export function classifySyncCursors(heights: ReadonlyMap<string, number>): L1SyncState {
  const values = SYNC_SOURCES.map((source) => heights.get(source) ?? 0);
  if (values.every((height) => height === 0)) return "unbuilt";
  if (values.some((height) => height === 0)) return "indexing";
  return new Set(values).size === 1 ? "reconciled" : "indexing";
}

export async function getSyncCursors(): Promise<Map<string, number>> {
  const rows = await indexerPrisma.syncCursor.findMany({
    where: { source: { in: [...SYNC_SOURCES] } },
  });
  return new Map(rows.map((row) => [row.source, Number(row.lastBlockHeight)]));
}

export async function getSyncCursor(source: string) {
  return indexerPrisma.syncCursor.findUnique({ where: { source } });
}

export async function setSyncCursor(
  source: string,
  lastBlockHeight: number,
  tx: IndexerTx = indexerPrisma,
) {
  await tx.syncCursor.upsert({
    where: { source },
    create: { source, lastBlockHeight },
    update: { lastBlockHeight },
  });
}
