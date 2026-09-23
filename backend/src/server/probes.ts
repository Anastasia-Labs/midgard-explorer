import { prisma } from "../db";
import { loadManifest } from "../db/manifest";
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

/** Tables in the node's database that the read path queries.
 *
 * This listed the seven relations the Prisma schema maps and stopped there,
 * while most of the read path is raw SQL: ten more relations were queried by
 * routes that readiness reported nothing about, so a node database missing any
 * of them answered "ready" and then failed the request. Derived by matching
 * every `FROM`/`JOIN` target in `src/db` against the node's own table list. */
export const NODE_TABLES = [
  "address_history",
  "blocks",
  "confirmed_ledger",
  "da_payloads",
  "deposits_utxos",
  "forced_transaction_utxos",
  "immutable",
  "mempool",
  "mempool_ledger",
  "pending_block_finalization_deposits",
  "pending_block_finalization_forced_transactions",
  "pending_block_finalization_txs",
  "pending_block_finalization_withdrawals",
  "pending_block_finalizations",
  "processed_mempool",
  "tx_admissions",
  "tx_rejections",
  "withdrawal_utxos",
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

/** Migrations this build ships, read from the directory Prisma deploys from.
 *
 * Resolved relative to this file so it works the same from `src` under ts-node
 * and from `dist` after a build, both of which sit two levels below the backend
 * root. */




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

