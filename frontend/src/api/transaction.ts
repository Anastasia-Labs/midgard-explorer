import axios from "axios";
import { config } from "../config";

export async function fetchTransaction(txId: string) {
  if (!txId) {
    throw new Error("Missing txId");
  }

  const base = config.midgardNode.replace(/\/+$/, "");
  const url = `${base}/tx?tx_hash=${encodeURIComponent(txId)}`;
  const response = await axios.get(url);
  return response.data;
}
