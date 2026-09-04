import type { Client } from "pg";

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
  statements: number;
  /** `shared_blks_hit + shared_blks_read`, summed over statements. */
  sharedBlocks: number;
  tempBytes: number;
  /** Total time PostgreSQL reports for the statements, in milliseconds. */
  execMs: number;
};

export const ZERO_WORK: DbWork = {
  statements: 0,
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
      const { rows } = await control.query<{
        calls: string | null;
        shared: string | null;
        temp: string | null;
        ms: string | null;
      }>(
        `SELECT sum(calls)::text AS calls,
                sum(shared_blks_hit + shared_blks_read)::text AS shared,
                sum(temp_blks_read + temp_blks_written)::text AS temp,
                sum(total_exec_time)::text AS ms
           FROM pg_stat_statements
          WHERE query NOT LIKE '%pg_stat_statements%'`,
      );
      const row = rows[0];
      return {
        statements: Number(row?.calls ?? 0),
        sharedBlocks: Number(row?.shared ?? 0),
        tempBytes: Number(row?.temp ?? 0) * blocks,
        execMs: Number(row?.ms ?? 0),
      };
    },
  };
}
