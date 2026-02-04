import axios from "axios";
import { config } from "../config";

export async function fetchAddressTransactions(address: string) {
  if (!address) {
    throw new Error("Missing address");
  }

  const base = config.midgardNode.replace(/\/+$/, "");
  const url = `${base}/txs?address=${encodeURIComponent(address)}`;
  const response = await axios.get(url);
  return response.data;
}
