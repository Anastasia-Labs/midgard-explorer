import axios from "axios";
export async function fetchTransaction(txId: string) {
  if (!txId) {
    throw new Error("Missing txId");
  }

  const url = `/api/transcation?tx_hash=${encodeURIComponent(txId)}`;
  const response = await axios.get(url);
  const data = response.data ?? {};
  return { tx: data.tx?.tx ?? data.tx };
}

export async function fetchTotalTransactions() {
  const response = await axios.get("/api/transactions/total");
  return response.data;
}

type RecentTransaction = {
  header_hash: string;
  tx_id: string;
  time_stamp_tz: string;
};

type TransactionsPageResponse = {
  rows: RecentTransaction[];
  total: number;
  limit: number;
  hasNextPage: boolean;
};

export async function fetchRecentTransactions() {
  const response = await axios.get("/api/transactions/recent");
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
  const response = await axios.get(`/api/transactions/${page}`);
  const data = response.data ?? {};
  const rows: RecentTransaction[] = Array.isArray(data?.rows)
    ? data.rows
    : [];
  return {
    rows,
    total: typeof data.total === "number" ? data.total : 0,
    limit: typeof data.limit === "number" ? data.limit : rows.length,
    hasNextPage: Boolean(data.hasNextPage),
  } as TransactionsPageResponse;
}
