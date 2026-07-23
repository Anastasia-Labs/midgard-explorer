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

// Checks tiers in priority order: immutable (committed), processed_mempool
// (pending_commit), mempool (accepted). A tx may exist in multiple tiers
// transiently. `pending` flags unconfirmed txs; `source` records the tier found.
export async function getTransaction(txId: string) {
  const txBytes = toBytes(txId);
  const immutableRow = await prisma.immutableTx.findUnique({
    where: { tx_id: txBytes },
  });
  if (immutableRow) {
    return { ...immutableRow, pending: false, source: "immutable" as const };
  }

  const processedRow = await prisma.processedMempoolTx.findUnique({
    where: { tx_id: txBytes },
  });
  if (processedRow) {
    return {
      ...processedRow,
      pending: true,
      source: "processed_mempool" as const,
    };
  }

  const mempoolRow = await prisma.mempoolTx.findUnique({
    where: { tx_id: txBytes },
  });
  return mempoolRow
    ? { ...mempoolRow, pending: true, source: "mempool" as const }
    : null;
}

export type TxLifecycle =
  | {
      status: "rejected";
      reasonCode: string;
      reasonDetail: string | null;
      rejectedAt: Date;
    }
  | { status: "queued" | "validating" | "accepted" }
  | null;

/** Lifecycle for txs not present in any tx table: rejected, or still in admission. */
export async function getTxLifecycle(txId: string): Promise<TxLifecycle> {
  const txBytes = toBytes(txId);
  const rejections = await prisma.$queryRaw<
    Array<{
      reject_code: string;
      reject_detail: string | null;
      created_at: Date;
    }>
  >`SELECT reject_code, reject_detail, created_at FROM tx_rejections
    WHERE tx_id = ${txBytes} ORDER BY created_at DESC LIMIT 1;`;
  if (rejections.length > 0) {
    return {
      status: "rejected",
      reasonCode: rejections[0].reject_code,
      reasonDetail: rejections[0].reject_detail,
      rejectedAt: rejections[0].created_at,
    };
  }

  const admissions = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM tx_admissions WHERE tx_id = ${txBytes};`;
  const admissionStatus = admissions[0]?.status;
  if (
    admissionStatus === "queued" ||
    admissionStatus === "validating" ||
    admissionStatus === "accepted"
  ) {
    return { status: admissionStatus };
  }

  return null;
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
