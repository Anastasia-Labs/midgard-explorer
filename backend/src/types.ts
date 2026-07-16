export type Config = {
  BACKEND_PORT: number;
  CORS_ORIGIN: string;
  POSTGRES_URL: string;
  LOG_LOCATION: string;
  NODE_RPC_HOST: string;
  NODE_RPC_PORT: number;
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  RECENT_BLOCKS_LIMIT: number;
  RECENT_TRANSACTIONS_LIMIT: number;
  TRANSACTIONS_PER_PAGE: number;
  BLOCKS_PER_PAGE: number;
};
