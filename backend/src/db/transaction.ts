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
      reasonCode: string | null;
      reasonDetail: string | null;
      rejectedAt: Date | null;
    }
  | { status: "queued" | "validating" | "accepted" }
  | null;

export type TxAdmission = {
  status: string;
  firstSeenAt: Date;
  validationStartedAt: Date | null;
  terminalAt: Date | null;
  updatedAt: Date;
  attemptCount: number;
  requestCount: number;
  submitSource: string;
  rejectCode: string | null;
  rejectDetail: string | null;
};

/** Admission timing and retry metadata remains available after ledger inclusion. */
export async function getTxAdmission(
  txId: string,
): Promise<TxAdmission | null> {
  const txBytes = toBytes(txId);
  const admissions = await prisma.$queryRaw<
    Array<{
      status: string;
      first_seen_at: Date;
      validation_started_at: Date | null;
      terminal_at: Date | null;
      updated_at: Date;
      attempt_count: number;
      request_count: bigint;
      submit_source: string;
      reject_code: string | null;
      reject_detail: string | null;
    }>
  >`SELECT status, first_seen_at, validation_started_at, terminal_at, updated_at,
      attempt_count, request_count, submit_source, reject_code, reject_detail
    FROM tx_admissions WHERE tx_id = ${txBytes};`;
  const row = admissions[0];
  if (!row) return null;
  return {
    status: row.status,
    firstSeenAt: row.first_seen_at,
    validationStartedAt: row.validation_started_at,
    terminalAt: row.terminal_at,
    updatedAt: row.updated_at,
    attemptCount: row.attempt_count,
    requestCount: Number(row.request_count),
    submitSource: row.submit_source,
    rejectCode: row.reject_code,
    rejectDetail: row.reject_detail,
  };
}

/** Lifecycle for txs not present in any tx table: rejected, or still in admission. */
export async function getTxLifecycle(
  txId: string,
  knownAdmission?: TxAdmission | null,
): Promise<TxLifecycle> {
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

  const admission =
    knownAdmission === undefined ? await getTxAdmission(txId) : knownAdmission;
  const admissionStatus = admission?.status;
  if (admission?.status === "rejected") {
    return {
      status: "rejected",
      reasonCode: admission.rejectCode,
      reasonDetail: admission.rejectDetail,
      rejectedAt: admission.terminalAt,
    };
  }
  if (
    admissionStatus === "queued" ||
    admissionStatus === "validating" ||
    admissionStatus === "accepted"
  ) {
    return { status: admissionStatus };
  }

  return null;
}

export type TxInclusion = {
  height: number;
  header_hash: Uint8Array;
  time_stamp_tz: Date;
};

/** The L2 block carrying this transaction. `blocks` holds one row per
 * block-tx pair, so this is the transaction's side of that join and the only
 * path from a transaction to its L1 settlement state. */
export async function getTxInclusion(txId: string): Promise<TxInclusion | null> {
  const rows = await prisma.blocks.findMany({
    where: { tx_id: toBytes(txId) },
    orderBy: { height: "desc" },
    take: 1,
    select: { height: true, header_hash: true, time_stamp_tz: true },
  });
  return rows[0] ?? null;
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
