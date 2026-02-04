import { prisma } from "../db";

export async function getAllImmutableTxs() {
  return prisma.immutableTx.findMany();
}

export async function getAllMempoolTxs() {
  return prisma.mempoolTx.findMany();
}

export async function getAllProcessedMempoolTxs() {
  return prisma.processedMempoolTx.findMany();
}
