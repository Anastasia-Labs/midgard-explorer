import { prisma } from "../db";
import { readConsistently } from "./consistent";

const LIMIT = 25;

export async function getDepositsPage(page: number, eventId?: string) {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * LIMIT;
  // Rows and total in one snapshot: see `readConsistently`.
  const [rows, totalRows] = await readConsistently(async (db) =>
    Promise.all(  [
      db.$queryRaw<
        Array<{
          event_id: Uint8Array;
          deposit_l1_tx_hash: Uint8Array;
          ledger_tx_id: Uint8Array;
          ledger_address: string;
          ledger_output: Uint8Array;
          status: string;
          inclusion_time: Date;
          projected_header_hash: Uint8Array | null;
        }>
      >`SELECT event_id, deposit_l1_tx_hash, ledger_tx_id, ledger_address,
           ledger_output, status, inclusion_time, projected_header_hash
         FROM deposits_utxos
         WHERE (${eventId ?? null}::text IS NULL OR encode(event_id, 'hex') = ${eventId ?? null})
         ORDER BY inclusion_time DESC, event_id DESC
         LIMIT ${LIMIT + 1} OFFSET ${offset};`,
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM deposits_utxos
         WHERE (${eventId ?? null}::text IS NULL OR encode(event_id, 'hex') = ${eventId ?? null});`,
    ]),
  );
  return {
    rows: rows.slice(0, LIMIT),
    hasNextPage: rows.length > LIMIT,
    total: Number(totalRows[0].count),
    limit: LIMIT,
  };
}
