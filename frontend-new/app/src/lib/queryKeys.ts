/** Central query-key factory + cache policy by resource class.
 * Same keys are used for server prefetch and client hydration. */
export const queryKeys = {
  block: (headerHash: string) => ["block", headerHash] as const,
  transaction: (txHash: string) => ["transaction", txHash] as const,
  address: (address: string) => ["address", address] as const,
  recentBlocks: ["blocks", "recent"] as const,
  totalBlocks: ["blocks", "total"] as const,
  blocksPage: (page: number) => ["blocks", "page", page] as const,
  recentTxs: ["transactions", "recent"] as const,
  totalTxs: ["transactions", "total"] as const,
  txsPage: (page: number) => ["transactions", "page", page] as const,
  depositsPage: (page: number) => ["deposits", "page", page] as const,
  withdrawalsPage: (page: number) => ["withdrawals", "page", page] as const,
  forcedTxsPage: (page: number) => ["forced-transactions", "page", page] as const,
};

export const cachePolicy = {
  immutableDetail: { staleTime: Infinity, gcTime: 30 * 60_000 },
  liveList: { staleTime: 5_000, refetchInterval: 10_000 },
  totals: { staleTime: 30_000, refetchInterval: 30_000 },
  pendingLifecycle: { staleTime: 0, refetchInterval: 5_000 },
  bridgeList: { staleTime: 15_000, refetchInterval: 15_000 },
  pagedHistory: { staleTime: 60_000 },
};

export const TERMINAL_TX_STATUSES = new Set(["committed", "rejected"]);
