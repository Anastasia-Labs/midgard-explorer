import axios from "axios";
export async function fetchBlock(headerHash: string) {
  if (!headerHash) {
    throw new Error("Missing headerHash");
  }

  const url = `/api/block?header_hash=${encodeURIComponent(headerHash)}`;
  const response = await axios.get(url);
  return response.data;
}

export async function fetchTotalBlocks() {
  const response = await axios.get("/api/blocks/total");
  return response.data;
}
