import { prisma } from "../db";
import { readConsistently } from "./consistent";

/** Native-asset queries over the live ledger.
 *
 * Midgard stores a UTxO's value inside canonical CBOR, so there is no asset
 * column to index and no way to filter in SQL. Answering "who holds this
 * asset" means decoding outputs. That is honest but not free, so every query
 * here is bounded and reports what it covered: a holder list that silently
 * stopped at some arbitrary row would be worse than one that says where it
 * stopped.
 */

/** Ceiling on UTxOs decoded per request. Chosen to bound the work rather than
 * to be exactly right: the response says how many rows were scanned and
 * whether more exist, so a reader can tell a complete answer from a partial. */
export const SCAN_LIMIT = 20_000;

export type LedgerScanRow = { address: string; output: Uint8Array };

/** Spendable ledger rows, in the same sense the address page uses: deposit
 * sourced rows count only once their deposit is projected. */
export async function getSpendableLedger(
  limit: number = SCAN_LIMIT,
): Promise<{ rows: LedgerScanRow[]; total: number; truncated: boolean }> {
  // One snapshot. The scan and its coverage total are the same question asked
  // twice, and a UTxO spent between them makes the coverage figure describe a
  // ledger the rows never came from.
  const [rows, totalRows] = await readConsistently(async (db) =>
    Promise.all([
    db.$queryRaw<LedgerScanRow[]>`
      SELECT ml.address, ml.output
        FROM mempool_ledger AS ml
        LEFT JOIN deposits_utxos AS d ON d.event_id = ml.source_event_id
       WHERE ml.source_event_id IS NULL OR d.projected_header_hash IS NOT NULL
       ORDER BY encode(ml.outref, 'hex') ASC
       LIMIT ${limit};`,
    db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
        FROM mempool_ledger AS ml
        LEFT JOIN deposits_utxos AS d ON d.event_id = ml.source_event_id
       WHERE ml.source_event_id IS NULL OR d.projected_header_hash IS NOT NULL;`,
  ]),
  );
  const total = Number(totalRows[0]?.n ?? 0n);
  return { rows, total, truncated: total > rows.length };
}
