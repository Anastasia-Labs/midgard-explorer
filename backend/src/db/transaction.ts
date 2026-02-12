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
  const [rows, total] = await Promise.all([
    prisma.blocks.findMany({
      orderBy: { height: "desc" },
      skip: (safePage - 1) * limit,
      take: limit,
    }),
    prisma.blocks.count(),
  ]);
  const hasNextPage = safePage * limit < total;
  return { rows, hasNextPage, total, limit };
}
