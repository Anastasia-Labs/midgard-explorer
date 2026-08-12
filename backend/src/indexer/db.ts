import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma-indexer/indexer-client";
import { config } from "../config";

// The database the explorer owns. Separate client from src/db.ts, which reads
// the node's Postgres and never writes to it.
const adapter = new PrismaPg({ connectionString: config.INDEXER_POSTGRES_URL });
export const indexerPrisma = new PrismaClient({ adapter });

/** The client Prisma hands an interactive transaction. Every write helper takes
 * one so a whole sync pass commits or rolls back as a unit. */
export type IndexerTx = Omit<
  typeof indexerPrisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

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
