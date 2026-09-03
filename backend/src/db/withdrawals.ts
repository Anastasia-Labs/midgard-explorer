import { prisma } from "../db";
import { readConsistently } from "./consistent";

const LIMIT = 25;

export async function getWithdrawalsPage(page: number, eventId?: string) {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * LIMIT;
  // Rows and total in one snapshot: see `readConsistently`.
  const [rows, totalRows] = await readConsistently(async (db) =>
    Promise.all(  [
      db.$queryRaw<
        Array<{
          event_id: Uint8Array;
          withdrawal_l1_tx_hash: Uint8Array;
          withdrawal_l1_output_index: number;
          l2_outref: Uint8Array;
          l2_value: Uint8Array;
          l1_address: Uint8Array;
          validity: string | null;
          status: string;
          inclusion_time: Date;
          projected_header_hash: Uint8Array | null;
        }>
      >`SELECT event_id, withdrawal_l1_tx_hash, withdrawal_l1_output_index,
           l2_outref, l2_value, l1_address, validity, status, inclusion_time,
           projected_header_hash
         FROM withdrawal_utxos
         WHERE (${eventId ?? null}::text IS NULL OR encode(event_id, 'hex') = ${eventId ?? null})
         ORDER BY inclusion_time DESC, event_id DESC
         LIMIT ${LIMIT + 1} OFFSET ${offset};`,
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM withdrawal_utxos
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
