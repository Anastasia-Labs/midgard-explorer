import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma-indexer/indexer-client";
import { config } from "../config";

// The database the explorer owns. Separate client from src/db.ts, which reads
// the node's Postgres and never writes to it.
const adapter = new PrismaPg({ connectionString: config.INDEXER_POSTGRES_URL });
export const indexerPrisma = new PrismaClient({ adapter });

export async function getSyncCursor(source: string) {
  return indexerPrisma.syncCursor.findUnique({ where: { source } });
}

export async function setSyncCursor(source: string, lastBlockHeight: number) {
  await indexerPrisma.syncCursor.upsert({
    where: { source },
    create: { source, lastBlockHeight },
    update: { lastBlockHeight },
  });
}
