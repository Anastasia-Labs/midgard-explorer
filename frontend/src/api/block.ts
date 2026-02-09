import axios from "axios";

type RecentBlock = {
  header_hash: string;
  time_stamp_tz: string;
};

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

export async function fetchRecentBlocks() {
  const response = await axios.get("/api/blocks/recent");
  const rows: RecentBlock[] = Array.isArray(response.data?.rows)
    ? response.data.rows
    : [];
  const unique = new Map<string, RecentBlock>();
  for (const row of rows) {
    if (!row?.header_hash) continue;
    if (!unique.has(row.header_hash)) {
      unique.set(row.header_hash, {
        header_hash: row.header_hash,
        time_stamp_tz: row.time_stamp_tz,
      });
    }
  }
  return Array.from(unique.values());
}
