import { readdirSync } from "node:fs";
import { join } from "node:path";
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

/** Migrations this build ships, read from the directory Prisma deploys from.
 *
 * Resolved relative to this file so it works the same from `src` under ts-node
 * and from `dist` after a build, both of which sit two levels below the backend
 * root. */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "prisma-indexer", "migrations");

export function shippedMigrations(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The explorer's own index, including that its migrations match this build.
 *
 * A schema one migration behind the code answers most queries and fails the one
 * that touches the new column, which reads as an intermittent bug rather than a
 * deployment that was never finished.
 *
 * Both halves are needed and only one was here. Counting unfinished rows in
 * `_prisma_migrations` finds a migration that started and broke; a migration
 * that was never applied at all has NO row there, so the count is zero and
 * readiness went green. That is the exact state this deployment was in: the
 * corrective attribution migration sat on disk, unapplied, while `/readyz`
 * reported ready. What ships is compared against what is recorded.
 */
export async function probeIndexDatabase(): Promise<void> {
  const client = indexerPrisma as unknown as Queryable;
  await assertTables(client, "the explorer index", INDEX_TABLES);

  const rows = await client.$queryRawUnsafe<
    Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
  >(
    `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations;`,
  );

  const broken = rows.filter(
    (row) => row.finished_at === null || row.rolled_back_at !== null,
  );
  if (broken.length > 0) {
    throw new Error(
      `the explorer index has ${broken.length} unfinished or rolled-back ` +
        `migrations: ${broken.map((row) => row.migration_name).join(", ")}`,
    );
  }

  const applied = new Set(rows.map((row) => row.migration_name));
  const unapplied = shippedMigrations().filter((name) => !applied.has(name));
  if (unapplied.length > 0) {
    throw new Error(
      `the explorer index is missing ${unapplied.length} ` +
        `${unapplied.length === 1 ? "migration" : "migrations"} this build ` +
        `ships: ${unapplied.join(", ")}. Run \`pnpm indexer:deploy\`.`,
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
