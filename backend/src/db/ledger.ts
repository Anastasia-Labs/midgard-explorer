import { prisma } from "../db";

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
): Promise<LedgerOutput | null> {
  const key = Buffer.from(outref);
  // ORDER BY priority enforces mempool→confirmed deterministically; a bare
  // UNION ALL + LIMIT 1 leaves the branch order to the planner.
  const rows = await prisma.$queryRaw<LedgerOutput[]>`
    SELECT address, output FROM (
      SELECT address, output, 0 AS priority FROM mempool_ledger WHERE outref = ${key}
      UNION ALL
      SELECT address, output, 1 AS priority FROM confirmed_ledger WHERE outref = ${key}
    ) AS candidates
    ORDER BY priority
    LIMIT 1;`;
  return rows[0] ?? null;
}
