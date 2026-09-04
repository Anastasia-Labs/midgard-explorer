import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { checksum, type Checksum } from "../test/helpers/throwawayDb.mjs";

/**
 * A frozen, checksummed copy of the explorer's real L1 index.
 *
 * The L1 data is real: 281 preprod transactions indexed from Koios, which no
 * generator should ever synthesize. Benchmarks read this copy and never the
 * live index, for two reasons that both matter. A benchmark that reads the live
 * index measures a moving target, so two runs are not comparable; and one that
 * writes to it corrupts the only real data the explorer has.
 *
 * The copy carries a content checksum, recorded with every baseline. A number
 * whose dataset cannot be named is not reproducible, and a baseline that is not
 * reproducible is an anecdote.
 *
 * The source connection is used for `SELECT` only. Nothing here writes to it.
 *
 * **Which database is the source is not obvious, and getting it wrong is
 * silent.** `test/setup-indexer-db.mts` overrides `INDEXER_POSTGRES_URL` with
 * the `_test` database before any test module loads, which is a deliberate
 * safety mechanism: the suite once deleted real indexed data. The consequence
 * is that a test reading `INDEXER_POSTGRES_URL` clones an empty database and
 * every assertion about "the real index" passes against nothing. So the
 * benchmark source is named separately, and an empty clone is an error rather
 * than a 0-row snapshot nobody notices.
 */

const MIGRATIONS = "prisma-indexer/migrations";

/** Copied in dependency order, and the order the checksum is taken in. */
export const INDEX_TABLES = [
  "sync_cursor",
  "index_binding",
  "l1_protocol_params",
  "l1_block_header",
  "l1_tx",
  "l1_tx_io",
  "l1_tx_asset",
  "l1_redeemer",
  "l1_event",
] as const;

export type IndexSnapshot = {
  /** Row counts and a digest over the copied tables. */
  checksum: Checksum;
  /**
   * Real Midgard L2 header hashes, from `l1_block_header.header_hash`.
   *
   * These come from the MBLC state-queue token the commit transaction minted,
   * so they are the genuine 28-byte header hashes rather than a re-derivation.
   * `generateDataset` assigns them to its settled blocks, which is what makes
   * I6 an agreement with real data rather than a shape check.
   */
  settledHashes: Buffer[];
};

/** Applies the index schema by replaying the checked-in migrations in order. */
export async function applyIndexSchema(target: Client): Promise<number> {
  const entries = (await readdir(MIGRATIONS, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  let applied = 0;
  for (const entry of entries) {
    const sql = await readFile(join(MIGRATIONS, entry, "migration.sql"), "utf8");
    await target.query(sql);
    applied += 1;
  }
  return applied;
}

const quoteIdent = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
};

/** Below the 65,535 bind-parameter cap, as in the shaped seed loader. */
const MAX_BIND_PARAMETERS = 60_000;

async function copyTable(
  source: Client,
  target: Client,
  table: string,
): Promise<number> {
  const { rows } = await source.query(`SELECT * FROM ${quoteIdent(table)}`);
  if (rows.length === 0) return 0;
  const columns = Object.keys(rows[0]);
  const perBatch = Math.max(1, Math.floor(MAX_BIND_PARAMETERS / columns.length));
  const columnList = columns.map(quoteIdent).join(", ");

  for (let start = 0; start < rows.length; start += perBatch) {
    const batch = rows.slice(start, start + perBatch);
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        const value = row[column];
        // `bigint` columns come back as strings from the driver already, but a
        // BigInt would serialise to `[object BigInt]` rather than failing.
        values.push(typeof value === "bigint" ? value.toString() : value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await target.query(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${tuples.join(", ")}`,
      values,
    );
  }
  return rows.length;
}

/**
 * Copies the live index into `target`, then freezes and checksums it.
 *
 * `target` must be a throwaway database created by the harness. Passing the
 * live index here would be the one mistake this module exists to prevent, so
 * the caller obtains `target` from `createDatabase`, which only ever returns a
 * generated, marked name.
 */
export async function cloneIndex(
  source: Client,
  target: Client,
): Promise<IndexSnapshot> {
  await applyIndexSchema(target);
  for (const table of INDEX_TABLES) {
    await copyTable(source, target, table);
  }
  for (const table of INDEX_TABLES) {
    await target.query(`ANALYZE ${quoteIdent(table)}`);
  }

  const { rows } = await target.query<{ header_hash: string }>(
    // Ordered, so the same snapshot always hands out the same hashes in the
    // same order. An unordered read would make the settled blocks shuffle
    // between runs and break I10 for a reason nothing else would explain.
    `SELECT header_hash FROM l1_block_header ORDER BY header_hash ASC`,
  );
  const digest = await checksum(target, INDEX_TABLES);
  assertUsableSnapshot(digest);
  return {
    checksum: digest,
    settledHashes: rows.map((row) => Buffer.from(row.header_hash, "hex")),
  };
}

/**
 * Refuses a snapshot that cannot support a benchmark.
 *
 * An empty clone is not a small dataset, it is the wrong database. The
 * `real+extended` workloads exist to measure real L1 volume, and against zero
 * rows they return instantly and pass every budget. Failing here is the only
 * way that surfaces.
 */
export function assertUsableSnapshot(digest: Checksum): void {
  if ((digest.tables.l1_tx ?? 0) === 0) {
    throw new Error(
      "index snapshot has no l1_tx rows: the source is empty or is the test " +
        "database. Set BENCH_SOURCE_INDEX_URL to the live explorer index; " +
        "INDEXER_POSTGRES_URL is overridden to the _test database under vitest.",
    );
  }
}
