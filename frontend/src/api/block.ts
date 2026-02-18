import axios from "axios";

type RecentBlock = {
  header_hash: string;
  time_stamp_tz: string;
};

type BlockTransactionRow = {
  height: number;
  header_hash: string;
  tx_id: string;
  time_stamp_tz: string;
  tx: string | null;
};

type BlockResponse = {
  rows: BlockTransactionRow[];
};

type BlocksPageResponse = {
  rows: RecentBlock[];
  total: number;
  limit: number;
  hasNextPage: boolean;
};

export async function fetchBlock(headerHash: string) {
  if (!headerHash) {
    throw new Error("Missing headerHash");
  }

  const url = `/api/block?header_hash=${encodeURIComponent(headerHash)}`;
  const response = await axios.get(url);
  const data = response.data ?? {};
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
  } as BlockResponse;
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

export async function fetchBlocksPage(page: number) {
  const response = await axios.get(`/api/blocks/${page}`);
  const data = response.data ?? {};
  const rows: RecentBlock[] = Array.isArray(data?.rows) ? data.rows : [];
  return {
    rows,
    total: typeof data.total === "number" ? data.total : 0,
    limit: typeof data.limit === "number" ? data.limit : rows.length,
    hasNextPage: Boolean(data.hasNextPage),
  } as BlocksPageResponse;
}
