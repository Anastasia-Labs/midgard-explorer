import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../prisma-indexer/indexer-client";
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

export async function getSyncCursors(tx: IndexerTx = indexerPrisma): Promise<Map<string, number>> {
  const rows = await tx.syncCursor.findMany({ where: { source: { in: [...SYNC_SOURCES] } } });
  return new Map(rows.map((row) => [row.source, Number(row.lastBlockHeight)]));
}

/**
 * Header, coverage and observation time from ONE snapshot of the index.
 *
 * Read separately, they answer questions about different moments. A pass that
 * commits between the header read and the cursor read produces the worst
 * possible combination: no header, and cursors fresh enough to call the index
 * current, so a settlement the index had just recorded was reported as absent
 * from an index that looked up to date. That is a false negative wearing the
 * evidence of a true one.
 *
 * REPEATABLE READ rather than a single join because the header and the cursors
 * live in unrelated tables with no key between them, and consistency here means
 * one moment, not one row.
 */
export async function readIndexConsistently<T>(work: (tx: IndexerTx) => Promise<T>): Promise<T> {
  return indexerPrisma.$transaction(work, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
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

/**
 * When each source last completed a reconciliation, not just how far it got.
 *
 * `getSyncCursors` returns heights and drops `updated_at`, so every freshness
 * question had to be answered from a height. A height cannot answer it: the
 * cursor records the coverage of the last completed pass, and on a quiet chain
 * that number is identical whether the writer ran a second ago or stopped a week
 * ago. The column was always there; nothing read it.
 */
export async function getSyncCursorTimes(tx: IndexerTx = indexerPrisma): Promise<Map<string, Date>> {
  const rows = await tx.syncCursor.findMany({ where: { source: { in: [...SYNC_SOURCES] } } });
  return new Map(rows.map((row) => [row.source, row.updatedAt]));
}

/**
 * Seconds since the index last completed a full pass, or null when it never has.
 *
 * The OLDEST of the three, because a source that has not reconciled since
 * yesterday makes the whole index that stale however recently the others ran.
 */
export function reconciliationAgeSeconds(
  times: ReadonlyMap<string, Date>,
  nowMs: number = Date.now(),
): number | null {
  const stamps = SYNC_SOURCES.map((source) => times.get(source)).filter(
    (at): at is Date => at !== undefined,
  );
  if (stamps.length < SYNC_SOURCES.length) return null;
  const oldest = Math.min(...stamps.map((at) => at.getTime()));
  return Math.max(0, Math.round((nowMs - oldest) / 1000));
}
