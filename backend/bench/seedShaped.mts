import type { Client } from "pg";
import { LOAD_ORDER, type Dataset, type Row } from "./generate.mjs";

/**
 * Loads a generated dataset into a database carrying the node schema.
 *
 * Multi-row `INSERT`, batched under the bind-parameter cap rather than `COPY`.
 * `COPY FROM STDIN` needs `pg-copy-streams`, and the specification permits
 * either; this avoids a dependency for a benchmark-only path. The cap is 65,535
 * parameters per statement, and the batch size is derived from the column count
 * so a wide table batches into fewer rows rather than overflowing.
 *
 * `ANALYZE` runs at the end and is not optional. Without it the planner works
 * from empty-table statistics, so every plan captured against the dataset is
 * fiction and every timing measures the wrong plan.
 */

/** Below the 65,535 cap, with room for a wide table's final row. */
const MAX_BIND_PARAMETERS = 60_000;

export type LoadReport = {
  /** Rows inserted per table, in load order. */
  inserted: Record<string, number>;
  total: number;
  analyzed: readonly string[];
};

const quoteIdent = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe identifier: ${name}`);
  }
  return `"${name}"`;
};

/**
 * Inserts one table's rows.
 *
 * Every row of a table must carry the same columns, taken from the first row.
 * A row with a different shape is a generator defect, and failing here names
 * the table rather than leaving Postgres to report a column count mismatch.
 */
async function insertTable(
  db: Client,
  table: string,
  rows: readonly Row[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const columns = Object.keys(rows[0]);
  for (const row of rows) {
    const keys = Object.keys(row);
    if (keys.length !== columns.length || keys.some((k, i) => k !== columns[i])) {
      throw new Error(
        `inconsistent row shape in ${table}: expected [${columns}], got [${keys}]`,
      );
    }
  }

  const perBatch = Math.max(1, Math.floor(MAX_BIND_PARAMETERS / columns.length));
  const columnList = columns.map(quoteIdent).join(", ");
  let inserted = 0;

  for (let start = 0; start < rows.length; start += perBatch) {
    const batch = rows.slice(start, start + perBatch);
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(normalize(row[column]));
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await db.query(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${tuples.join(", ")}`,
      values,
    );
    inserted += batch.length;
  }
  return inserted;
}

/**
 * `bigint` reaches the driver as a string.
 *
 * node-postgres serialises a JavaScript BigInt to `[object BigInt]` rather than
 * failing, so a count column silently becomes garbage. Every count in this
 * dataset is a BigInt because the columns are `bigint`.
 */
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

export async function seedDataset(
  db: Client,
  dataset: Dataset,
): Promise<LoadReport> {
  const inserted: Record<string, number> = {};
  let total = 0;
  for (const table of LOAD_ORDER) {
    const rows = dataset.tables[table] ?? [];
    inserted[table] = await insertTable(db, table, rows);
    total += inserted[table];
  }
  // Statistics, not a formality. See the note at the top of this file.
  const analyzed: string[] = [];
  for (const table of LOAD_ORDER) {
    await db.query(`ANALYZE ${quoteIdent(table)}`);
    analyzed.push(table);
  }
  return { inserted, total, analyzed };
}
