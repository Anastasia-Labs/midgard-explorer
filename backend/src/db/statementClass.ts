/**
 * Where a statement's cost belongs, for the production metrics.
 *
 * A copy of the classifier in `bench/attribution.mts`, not an import of it. The
 * bench runs as ES modules and the server compiles to CommonJS, and neither
 * loader resolves the other's exports at runtime, so one shared module broke
 * the bench CLI. `statement-class-parity.test.mts` runs both copies over the
 * same query texts and fails the moment they disagree.
 */

export type StatementClass =
  /** BEGIN, COMMIT, SET TRANSACTION ISOLATION LEVEL, SAVEPOINT. */
  | "transaction-control"
  /** The explorer's own bookkeeping: sync cursor and index binding. */
  | "metadata"
  /** Everything the route asked for on behalf of the response. */
  | "route-query";

/**
 * Collapses whitespace so a multi-line query reads as one line.
 *
 * In TypeScript, not SQL. The same normalisation was written twice as a
 * `regexp_replace(query, '\\s+', ...)` literal, and one copy sat in a template
 * literal where `\s` collapses to a plain `s`, so it stripped the letter s from
 * every query text. `sync_cursor` stopped matching and was counted as route
 * work; `index_binding`, which contains no s, kept matching. One helper, tested
 * once, removes the hazard rather than fixing it in two places.
 */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

const TRANSACTION_CONTROL =
  /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET\s+TRANSACTION|START\s+TRANSACTION)\b/i;

/** Tables that exist to describe the index, not to answer a request. */
const METADATA_TABLES = /\b(sync_cursor|index_binding)\b/i;

export function classifyStatement(query: string): StatementClass {
  if (TRANSACTION_CONTROL.test(query)) return "transaction-control";
  if (METADATA_TABLES.test(query)) return "metadata";
  return "route-query";
}
