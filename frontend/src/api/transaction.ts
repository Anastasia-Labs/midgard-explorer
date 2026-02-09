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
