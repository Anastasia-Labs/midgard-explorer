import { prisma } from "../db";
import type { NodeReader } from "./consistent";

export type LedgerOutput = { address: string; output: Uint8Array };

/**
 * Resolve a spent outref to the produced output it points at, scanning the ledger
 * tables (mempool first, then confirmed). The `outref` key is the
 * canonical `CML.TransactionInput` CBOR — the same bytes the codec yields for a
 * spend-input preimage item, so the raw item bytes are used directly as the key.
 *
 * Returns null when the UTxO is no longer present (already spent / pruned). Input
 * resolution is therefore best-effort: a tx's own inputs disappear from the ledger
 * once the tx is applied, so historical inputs will commonly be unresolvable.
 */
export async function findOutRef(
  outref: Uint8Array,
  db: NodeReader = prisma,
): Promise<LedgerOutput | null> {
  const key = Buffer.from(outref);
  // ORDER BY priority enforces mempool→confirmed deterministically; a bare
  // UNION ALL + LIMIT 1 leaves the branch order to the planner.
  const rows = await db.$queryRaw<LedgerOutput[]>`
    SELECT address, output FROM (
      SELECT address, output, 0 AS priority FROM mempool_ledger WHERE outref = ${key}
      UNION ALL
      SELECT address, output, 1 AS priority FROM confirmed_ledger WHERE outref = ${key}
    ) AS candidates
    ORDER BY priority
    LIMIT 1;`;
  return rows[0] ?? null;
}

/**
 * Every outref in one statement, keyed by its hex form.
 *
 * `findOutRef` resolves one, and the decoder called it once per input, once per
 * reference input and once more per output when computing spend status. A
 * transaction with twenty inputs therefore cost twenty round trips to answer one
 * question, repeated for every transaction on a list page.
 *
 * `= ANY($1)` rather than a generated `IN (...)`: one prepared shape whatever
 * the input count, so the planner caches it and a long list cannot blow the
 * parameter limit.
 */
export async function findOutRefs(
  outrefs: ReadonlyArray<Uint8Array>,
  db: NodeReader = prisma,
): Promise<Map<string, LedgerOutput>> {
  const found = new Map<string, LedgerOutput>();
  if (outrefs.length === 0) return found;

  // Deduplicated first: a transaction commonly references the same UTxO twice,
  // and asking for it twice is the cost this exists to remove.
  const unique = new Map<string, Buffer>();
  for (const outref of outrefs) {
    const key = Buffer.from(outref);
    unique.set(key.toString("hex"), key);
  }

  const rows = await db.$queryRaw<Array<LedgerOutput & { outref: Uint8Array }>>`
    SELECT DISTINCT ON (outref) outref, address, output FROM (
      SELECT outref, address, output, 0 AS priority
        FROM mempool_ledger WHERE outref = ANY(${[...unique.values()]})
      UNION ALL
      SELECT outref, address, output, 1 AS priority
        FROM confirmed_ledger WHERE outref = ANY(${[...unique.values()]})
    ) AS candidates
    ORDER BY outref, priority;`;

  for (const row of rows) {
    found.set(Buffer.from(row.outref).toString("hex"), {
      address: row.address,
      output: row.output,
    });
  }
  return found;
}

/**
 * A lookup that answers from one prefetched batch.
 *
 * Keeps the decoder's injected-lookup shape unchanged: it still asks for one
 * outref at a time and does not know a batch happened. Anything not in the
 * batch falls through to a single query, so a caller that under-prefetches gets
 * a slower answer rather than a wrong one.
 */
export function lookupFrom(
  batch: Map<string, LedgerOutput>,
  requested: ReadonlySet<string>,
) {
  return async (outref: Uint8Array): Promise<LedgerOutput | null> => {
    const key = Buffer.from(outref).toString("hex");
    const hit = batch.get(key);
    if (hit) return hit;
    // Absent from a batch that ASKED for it means absent, not unknown. Falling
    // through there would re-query every unresolvable input, and a historical
    // transaction's inputs are nearly all unresolvable, so the batch would cost
    // more than the loop it replaced.
    return requested.has(key) ? null : await findOutRef(outref);
  };
}
