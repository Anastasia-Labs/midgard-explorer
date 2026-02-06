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
