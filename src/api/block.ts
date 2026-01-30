import axios from "axios";
import { config } from "../config";

export async function fetchBlock(headerHash: string) {
  if (!headerHash) {
    throw new Error("Missing headerHash");
  }

  const base = config.midgardNode.replace(/\/+$/, "");
  const url = `${base}/block?header_hash=${encodeURIComponent(headerHash)}`;
  const response = await axios.get(url);
  return response.data;
}
