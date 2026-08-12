export type Config = {
  BACKEND_PORT: number;
  CORS_ORIGIN: string;
  POSTGRES_URL: string;
  LOG_LOCATION: string;
  // Unset in every current deployment: the explorer reads the node's Postgres
  // directly rather than calling it over HTTP. Validated when present.
  NODE_RPC_HOST?: string;
  NODE_RPC_PORT?: number;
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  RECENT_BLOCKS_LIMIT: number;
  RECENT_TRANSACTIONS_LIMIT: number;
  TRANSACTIONS_PER_PAGE: number;
  BLOCKS_PER_PAGE: number;
  INDEXER_POSTGRES_URL: string;
  KOIOS_BASE_URL: string;
  MIDGARD_MANIFEST_PATH: string;
  L1_SYNC_INTERVAL_MS: number;
  L1_REORG_LOOKBACK_BLOCKS: number;
};
