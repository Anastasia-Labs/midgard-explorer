import { api } from "./client";
import type { TransactionView, TxStatus } from "../cddl";

export type TxRejection = {
  reasonCode: string;
  reasonDetail: string | null;
  rejectedAt: string;
};

export async function fetchTransaction(txId: string) {
  if (!txId) {
    throw new Error("Missing txId");
  }

  const url = `/api/transaction?tx_hash=${encodeURIComponent(txId)}`;
  const response = await api.get(url);
  return {
    transaction: (response.data?.transaction ?? null) as TransactionView | null,
    status: response.data?.status as TxStatus | undefined,
    rejection: response.data?.rejection as TxRejection | undefined,
  };
}

export async function fetchTotalTransactions() {
  const response = await api.get("/api/transactions/total");
  return response.data;
}

type RecentTransaction = {
  header_hash: string;
  tx_id: string;
  time_stamp_tz: string;
};

type TransactionsPageRow = RecentTransaction & {
  transaction: TransactionView | null;
  decodeError: string | null;
};

type TransactionsPageResponse = {
  rows: TransactionsPageRow[];
  total: number;
  limit: number;
  hasNextPage: boolean;
};

export async function fetchRecentTransactions() {
  const response = await api.get("/api/transactions/recent");
  const rows: RecentTransaction[] = Array.isArray(response.data?.rows)
    ? response.data.rows
    : [];
  return rows.map((row) => ({
    header_hash: row.header_hash,
    tx_id: row.tx_id,
    time_stamp_tz: row.time_stamp_tz,
  }));
}

export async function fetchTransactionsPage(page: number) {
  const response = await api.get(`/api/transactions/${page}`);
  const data = response.data ?? {};
  const rows: TransactionsPageRow[] = Array.isArray(data?.rows)
    ? data.rows
    : [];
  return {
    rows,
    total: typeof data.total === "number" ? data.total : 0,
    limit: typeof data.limit === "number" ? data.limit : rows.length,
    hasNextPage: Boolean(data.hasNextPage),
  } as TransactionsPageResponse;
}
