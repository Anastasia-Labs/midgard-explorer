import { prisma } from "../db";
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
