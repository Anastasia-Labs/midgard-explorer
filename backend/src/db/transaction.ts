import { prisma } from "../db";
import { config } from "../config";
import { toBytes } from "../utils";

export async function getAllImmutableTxs() {
  return prisma.immutableTx.findMany();
}

export async function getAllMempoolTxs() {
  return prisma.mempoolTx.findMany();
}

export async function getAllProcessedMempoolTxs() {
  return prisma.processedMempoolTx.findMany();
}

// Note: Perhaps we should not fetch from mempool, given mempool is not yet committed
export async function getTransaction(txId: string) {
  const txBytes = toBytes(txId);
  const mempoolRow = await prisma.mempoolTx.findUnique({
    where: { tx_id: txBytes },
  });
  if (mempoolRow) {
    return mempoolRow;
  }

  const immutableRow = await prisma.immutableTx.findUnique({
    where: { tx_id: txBytes },
  });
  return immutableRow ?? null;
}

export async function getTotalTransactions() {
  return prisma.blocks.count();
}

export async function getTransactionsPage(page: number) {
  const limit = config.TRANSACTIONS_PER_PAGE;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        height: number;
        header_hash: Uint8Array;
        tx_id: Uint8Array;
        time_stamp_tz: Date;
        tx: Uint8Array | null;
      }>
    >`SELECT b.height,
        b.header_hash,
        b.tx_id,
        b.time_stamp_tz,
        COALESCE(i.tx, m.tx) AS tx
      FROM blocks AS b
      LEFT JOIN immutable AS i
        ON b.tx_id = i.tx_id
      LEFT JOIN mempool AS m
        ON b.tx_id = m.tx_id
      ORDER BY b.height DESC
      OFFSET ${offset}
      LIMIT ${limit};`,
    prisma.blocks.count(),
  ]);
  const hasNextPage = safePage * limit < total;
  return { rows, hasNextPage, total, limit };
}
