export type Config = {
  BACKEND_PORT: number;
  CORS_ORIGIN: string;
  POSTGRES_URL: string;
  MIDGARD_READ_REPLICA_URL?: string;
  REQUIRE_MIDGARD_READ_REPLICA: boolean;
  NODE_DB_POOL_MAX: number;
  INDEXER_DB_POOL_MAX: number;
  DB_CONNECTION_TIMEOUT_MS: number;
  DB_IDLE_TIMEOUT_MS: number;
  DB_STATEMENT_TIMEOUT_MS: number;
  RESPONSE_CACHE_MAX_ENTRIES: number;
  RESPONSE_CACHE_MAX_BYTES: number;
  API_RATE_LIMIT_MAX: number;
  API_RATE_LIMIT_WINDOW_MS: number;
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
  L1_SYNC_ENABLED: boolean;
  L1_REORG_LOOKBACK_BLOCKS: number;
};
