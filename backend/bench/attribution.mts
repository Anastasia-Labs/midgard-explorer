import type { Client } from "pg";

/**
 * Where a route's statements actually go.
 *
 * The baseline says `block-detail` issues 19 statements against a budget of 8,
 * but a count alone does not say whether the fix is a query change, a caching
 * change, or a transaction-shape change. The uniform overshoots across
 * unrelated routes (`metrics` 12 against 9, `asset-roster` 5 against 2) suggest
 * a shared per-request preamble rather than eleven separate query problems, and
 * that is a claim about composition that only attribution can settle.
 *
 * The classifier is pure and tested against real captured query texts. The
 * runner is the part that needs a database.
 */

export type StatementClass =
  /** BEGIN, COMMIT, SET TRANSACTION ISOLATION LEVEL, SAVEPOINT. */
  | "transaction-control"
  /** The explorer's own bookkeeping: sync cursor and index binding. */
  | "metadata"
  /** Everything the route asked for on behalf of the response. */
  | "route-query";

const TRANSACTION_CONTROL =
  /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET\s+TRANSACTION|START\s+TRANSACTION)\b/i;

/** Tables that exist to describe the index, not to answer a request. */
const METADATA_TABLES = /\b(sync_cursor|index_binding)\b/i;

export function classifyStatement(query: string): StatementClass {
  if (TRANSACTION_CONTROL.test(query)) return "transaction-control";
  if (METADATA_TABLES.test(query)) return "metadata";
  return "route-query";
}

export type AttributedStatement = {
  query: string;
  calls: number;
  perRequest: number;
  statementClass: StatementClass;
};

export type Attribution = {
  workload: string;
  requests: number;
  total: number;
  byClass: Record<StatementClass, number>;
  statements: AttributedStatement[];
};

/**
 * Reads `pg_stat_statements` and attributes it to one workload.
 *
 * The caller resets the view, issues exactly `requests` requests, then calls
 * this. Nothing else may touch the server in between, which is the same
 * condition the per-request budgets rest on.
 */
export async function attributeFrom(
  control: Client,
  workload: string,
  requests: number,
): Promise<Attribution> {
  const { rows } = await control.query<{ calls: string; query: string }>(
    `SELECT calls::text AS calls, regexp_replace(query, '\\s+', ' ', 'g') AS query
       FROM pg_stat_statements
      WHERE query NOT LIKE '%pg_stat_statements%'
      ORDER BY calls DESC, query ASC`,
  );

  const byClass: Record<StatementClass, number> = {
    "transaction-control": 0,
    metadata: 0,
    "route-query": 0,
  };
  const statements: AttributedStatement[] = [];
  let total = 0;

  for (const row of rows) {
    const calls = Number(row.calls);
    const statementClass = classifyStatement(row.query);
    byClass[statementClass] += calls / requests;
    total += calls / requests;
    statements.push({
      query: row.query,
      calls,
      perRequest: calls / requests,
      statementClass,
    });
  }

  return { workload, requests, total, byClass, statements };
}
