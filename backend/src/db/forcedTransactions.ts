import { prisma } from "../db";

const LIMIT = 25;

export async function getForcedTransactionsPage(page: number) {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * LIMIT;
  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        tx_order_id: Uint8Array;
        tx_order_l1_tx_hash: Uint8Array;
        tx_order_l1_output_index: number;
        tx_id: Uint8Array;
        operator_validity: string;
        status: string;
        inclusion_time: Date;
        projected_header_hash: Uint8Array | null;
      }>
    >`SELECT tx_order_id, tx_order_l1_tx_hash, tx_order_l1_output_index, tx_id,
         operator_validity, status, inclusion_time, projected_header_hash
       FROM forced_transaction_utxos
       ORDER BY inclusion_time DESC, tx_order_id DESC
       LIMIT ${LIMIT + 1} OFFSET ${offset};`,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM forced_transaction_utxos;`,
  ]);
  return {
    rows: rows.slice(0, LIMIT),
    hasNextPage: rows.length > LIMIT,
    total: Number(totalRows[0].count),
    limit: LIMIT,
  };
}
