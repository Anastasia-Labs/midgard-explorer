import { Request, Response } from "express";
import { config } from "../../config";
import { getLastTransactions } from "../../db/block";
import {
  getTotalTransactions,
  getTransaction,
  getTransactionsPage,
  getTxAdmission,
  getTxLifecycle,
} from "../../db/transaction";
import { findOutRef } from "../../db/ledger";
import {
  decodeTransaction,
  decodeTransactionSafe,
} from "../../decode/transaction";
import { isHexOfLength, toHex } from "../../utils";

export async function getTransactionRoute(req: Request, res: Response) {
  const txHash = req.query.tx_hash;
  if (typeof txHash !== "string" || txHash.length === 0) {
    return res.status(400).json({ error: "Missing tx_hash query param." });
  }
  if (!isHexOfLength(txHash, 64)) {
    return res.status(400).json({ error: "Invalid tx_hash." });
  }

  const [tx, admissionRecord] = await Promise.all([
    getTransaction(txHash),
    getTxAdmission(txHash),
  ]);
  const admission = admissionRecord
    ? {
        status: admissionRecord.status,
        firstSeenAt: admissionRecord.firstSeenAt,
        validationStartedAt: admissionRecord.validationStartedAt,
        terminalAt: admissionRecord.terminalAt,
        updatedAt: admissionRecord.updatedAt,
        attemptCount: admissionRecord.attemptCount,
        requestCount: admissionRecord.requestCount,
        submitSource: admissionRecord.submitSource,
      }
    : null;
  if (!tx) {
    const lifecycle = await getTxLifecycle(txHash, admissionRecord);
    if (lifecycle?.status === "rejected") {
      return res.json({
        transaction: null,
        status: "rejected",
        admission,
        rejection: {
          reasonCode: lifecycle.reasonCode,
          reasonDetail: lifecycle.reasonDetail,
          rejectedAt: lifecycle.rejectedAt,
        },
      });
    }
    if (lifecycle) {
      return res.json({
        transaction: null,
        status: lifecycle.status,
        admission,
      });
    }
    return res.status(404).json({ error: "Transaction not found." });
  }

  const status =
    tx.source === "immutable"
      ? "committed"
      : tx.source === "processed_mempool"
        ? "pending_commit"
        : "accepted";

  try {
    const transaction = await decodeTransaction(tx.tx, findOutRef);
    return res.json({
      transaction: {
        ...transaction,
        timestamp: tx.time_stamp_tz,
        pending: tx.pending,
      },
      status,
      admission,
    });
  } catch (err) {
    return res.status(422).json({
      error: "Failed to decode transaction.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getTotalTransactionsRoute(_req: Request, res: Response) {
  const total = await getTotalTransactions();
  return res.json({ total });
}

export async function getRecentTransactionsRoute(_req: Request, res: Response) {
  const rows = await getLastTransactions(config.RECENT_TRANSACTIONS_LIMIT);
  const payload = rows.map((row) => ({
    ...row,
    header_hash: toHex(row.header_hash),
    tx_id: toHex(row.tx_id),
  }));
  return res.json({ rows: payload });
}

export async function getTransactionsPageRoute(req: Request, res: Response) {
  const page = Number(req.params.page);
  if (!Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: "Invalid page." });
  }

  const { rows, hasNextPage, total, limit } = await getTransactionsPage(page);
  const payload = await Promise.all(
    rows.map(async (row) => {
      const decoded = row.tx
        ? await decodeTransactionSafe(row.tx)
        : { transaction: null, error: null as string | null };
      return {
        header_hash: toHex(row.header_hash),
        tx_id: toHex(row.tx_id),
        time_stamp_tz: row.time_stamp_tz,
        transaction: decoded.transaction,
        decodeError: decoded.error,
      };
    }),
  );
  return res.json({ rows: payload, hasNextPage, total, limit });
}
