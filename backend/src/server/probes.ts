import { prisma } from "../db";
import { indexerPrisma } from "../indexer/db";
import { loadManifest } from "../indexer/manifest";
import { config } from "../config";

/**
 * What readiness has to prove.
 *
 * `SELECT 1` proves a connection can be handed out and nothing else. It
 * answered "ready" against a generic empty PostgreSQL with none of the tables
 * either query path needs, which is exactly what CI provisioned, so the boot
 * check passed while the suite would have failed on a missing relation.
 *
 * These probes reject on the conditions that actually make the explorer unable
 * to serve: a database missing the relations it is queried through, an index
 * whose migrations do not match this build, and a manifest that cannot be read.
 */

/** Tables in the node's database that the read path queries. */
export const NODE_TABLES = [
  "confirmed_ledger",
  "mempool_ledger",
  "immutable",
  "mempool",
  "processed_mempool",
  "blocks",
  "address_history",
] as const;

/** Tables in the explorer's own index. */
export const INDEX_TABLES = [
  "sync_cursor",
  "l1_tx",
  "l1_tx_io",
  "l1_tx_asset",
  "l1_redeemer",
  "l1_event",
  "l1_block_header",
  "l1_protocol_params",
] as const;

export type Queryable = {
  $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T>;
};

/** `to_regclass` returns null for a relation that does not exist rather than
 * raising, so one round trip can report every missing table at once instead of
 * failing on the first. */
export async function missingRelations(
  client: Queryable,
  tables: readonly string[],
): Promise<string[]> {
  const selects = tables
    .map((t, i) => `to_regclass($${i + 1}) IS NOT NULL AS "t${i}"`)
    .join(", ");
  const [row] = await client.$queryRawUnsafe<Array<Record<string, boolean>>>(
    `SELECT ${selects};`,
    ...tables.map((t) => `public.${t}`),
  );
  return tables.filter((_, i) => row?.[`t${i}`] !== true);
}

async function assertTables(
  client: Queryable,
  label: string,
  tables: readonly string[],
): Promise<void> {
  const missing = await missingRelations(client, tables);
  if (missing.length > 0) {
    throw new Error(
      `${label} is missing ${missing.length} required ` +
        `${missing.length === 1 ? "relation" : "relations"}: ${missing.join(", ")}`,
    );
  }
}

/** The node's database, which holds every L2 record. */
export async function probeNodeDatabase(): Promise<void> {
  await assertTables(prisma as unknown as Queryable, "the node database", NODE_TABLES);
}

/**
 * The explorer's own index, including that its migrations match this build.
 *
 * A schema one migration behind the code answers most queries and fails the one
 * that touches the new column, which reads as an intermittent bug rather than a
 * deployment that was never finished.
 */
export async function probeIndexDatabase(): Promise<void> {
  const client = indexerPrisma as unknown as Queryable;
  await assertTables(client, "the explorer index", INDEX_TABLES);

  const [row] = await client.$queryRawUnsafe<Array<{ pending: bigint }>>(
    `SELECT count(*)::bigint AS pending
       FROM _prisma_migrations
      WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;`,
  );
  if (row && Number(row.pending) > 0) {
    throw new Error(
      `the explorer index has ${row.pending} unfinished or rolled-back migrations`,
    );
  }
}

/**
 * The deployment manifest.
 *
 * Every indexed row is attributed to the identity this file declares, and every
 * validator page is filtered by it. A manifest that cannot be read means the
 * process can answer queries that return nothing, which is worse than refusing
 * traffic, so it belongs in readiness rather than in a log line at boot.
 */
export async function probeManifest(): Promise<void> {
  loadManifest(config.MIDGARD_MANIFEST_PATH);
}
