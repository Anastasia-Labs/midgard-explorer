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
