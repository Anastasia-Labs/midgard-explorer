import type { Client } from "pg";
import { classifyStatement } from "./attribution.mjs";

/**
 * Database work per request, measured from PostgreSQL rather than guessed.
 *
 * Three figures the budgets name, and one trap each:
 *
 *   - **statements.** From `pg_stat_statements.calls`. Counting from the
 *     application would count what the application believes it sent, which is
 *     not the same thing once a driver adds its own round trips.
 *   - **shared blocks, `hit + read`.** Never `read` alone. A sequential scan
 *     served entirely from shared buffers reports zero reads, so a read-only
 *     budget passes while doing exactly the work it exists to catch.
 *   - **temp bytes.** Spilling to disk is how a sort silently stops fitting in
 *     `work_mem`, and it does not show up in latency until it is severe.
 *
 * `pg_stat_statements` is cluster-wide, so one probe covers every database on
 * the instance. That is why the harness puts the seeded node database and the
 * index snapshot on the same dedicated benchmark server: one reset, one read,
 * and the totals genuinely span both.
 */

export type DbWork = {
  /** Every statement, including the transaction preamble. */
  statements: number;
  /**
   * Statements the route issued on the response's behalf.
   *
   * The budget is judged on this. Every request also pays a fixed
   * `BEGIN` / `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` / `COMMIT`,
   * which is the snapshot consistency the explorer depends on rather than
   * anything a query change could remove. Counting it made `asset-roster`'s
   * budget of two statements unreachable at any query count, and made seven of
   * eight failures a property of the preamble rather than of the route.
   */
  routeStatements: number;
  /** The transaction preamble, recorded but not judged. */
  transactionControl: number;
  /** `sync_cursor` and `index_binding` bookkeeping, recorded but not judged. */
  metadataStatements: number;
  /** `shared_blks_hit + shared_blks_read`, summed over statements. */
  sharedBlocks: number;
  tempBytes: number;
  /** Total time PostgreSQL reports for the statements, in milliseconds. */
  execMs: number;
};

export const ZERO_WORK: DbWork = {
  statements: 0,
  routeStatements: 0,
  transactionControl: 0,
  metadataStatements: 0,
  sharedBlocks: 0,
  tempBytes: 0,
  execMs: 0,
};

/** True when the extension is present and readable on this connection. */
export async function hasStatementStats(db: Client): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT count(*) > 0 AS ok FROM pg_extension WHERE extname = 'pg_stat_statements'`,
  );
  return rows[0]?.ok === true;
}

async function blockSize(db: Client): Promise<number> {
  const { rows } = await db.query<{ setting: string }>(
    `SELECT setting FROM pg_settings WHERE name = 'block_size'`,
  );
  return Number(rows[0]?.setting ?? 8192);
}

export type DbProbe = {
  /** Clears the counters. Call immediately before the work to be measured. */
  reset: () => Promise<void>;
  /** Totals since the last reset. */
  read: () => Promise<DbWork>;
  available: boolean;
};

/**
 * A probe over one cluster's statement statistics.
 *
 * `available: false` when the extension is missing, and every reading is then
 * zero. A caller must report that as unmeasured rather than as a pass: a budget
 * of "at most four statements" is satisfied by a probe that always says zero,
 * which is the most convincing kind of false green.
 */
export async function createDbProbe(control: Client): Promise<DbProbe> {
  const available = await hasStatementStats(control);
  if (!available) {
    return { reset: async () => {}, read: async () => ZERO_WORK, available };
  }
  const blocks = await blockSize(control);
  return {
    available,
    reset: async () => {
      await control.query(`SELECT pg_stat_statements_reset()`);
    },
    read: async () => {
      // Per query, not one aggregate: the class split is what the budget is
      // judged on, and it cannot be recovered from a sum.
      const { rows } = await control.query<{
        calls: string;
        query: string;
        shared: string | null;
        temp: string | null;
        ms: string | null;
      }>(
        `SELECT calls::text AS calls,
                regexp_replace(query, '\s+', ' ', 'g') AS query,
                (shared_blks_hit + shared_blks_read)::text AS shared,
                (temp_blks_read + temp_blks_written)::text AS temp,
                total_exec_time::text AS ms
           FROM pg_stat_statements
          WHERE query NOT LIKE '%pg_stat_statements%'`,
      );
      const work = { ...ZERO_WORK };
      for (const row of rows) {
        const calls = Number(row.calls);
        work.statements += calls;
        work.sharedBlocks += Number(row.shared ?? 0);
        work.tempBytes += Number(row.temp ?? 0) * blocks;
        work.execMs += Number(row.ms ?? 0);
        const kind = classifyStatement(row.query);
        if (kind === "transaction-control") work.transactionControl += calls;
        else if (kind === "metadata") work.metadataStatements += calls;
        else work.routeStatements += calls;
      }
      return work;
    },
  };
}
