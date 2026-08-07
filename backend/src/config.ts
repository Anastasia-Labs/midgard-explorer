import { Config } from "./types";
import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";

// expand() resolves ${VAR} references in .env (e.g. POSTGRES_URL is built from the
// discrete POSTGRES_* vars). Prisma 6's engine did this internally; the v7 driver
// adapter reads process.env directly, so we own the expansion here.
expand(dotenv.config());

export const config: Config = {
  BACKEND_PORT: Number(process.env.BACKEND_PORT),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "*",
  POSTGRES_URL: process.env.POSTGRES_URL as string,
  LOG_LOCATION: process.env.LOG_LOCATION as string,
  NODE_RPC_HOST: process.env.NODE_RPC_HOST as string,
  NODE_RPC_PORT: Number(process.env.NODE_RPC_PORT),
  POSTGRES_HOST: process.env.POSTGRES_HOST as string,
  POSTGRES_PORT: Number(process.env.POSTGRES_PORT),
  POSTGRES_USER: process.env.POSTGRES_USER as string,
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD as string,
  POSTGRES_DB: process.env.POSTGRES_DB as string,
  RECENT_BLOCKS_LIMIT: Number(process.env.RECENT_BLOCKS_LIMIT),
  RECENT_TRANSACTIONS_LIMIT: Number(process.env.RECENT_TRANSACTIONS_LIMIT),
  TRANSACTIONS_PER_PAGE: Number(process.env.TRANSACTIONS_PER_PAGE),
  BLOCKS_PER_PAGE: Number(process.env.BLOCKS_PER_PAGE),
  INDEXER_POSTGRES_URL: process.env.INDEXER_POSTGRES_URL as string,
  KOIOS_BASE_URL: process.env.KOIOS_BASE_URL as string,
  MIDGARD_MANIFEST_PATH: process.env.MIDGARD_MANIFEST_PATH as string,
  L1_SYNC_INTERVAL_MS: Number(process.env.L1_SYNC_INTERVAL_MS),
  L1_REORG_LOOKBACK_BLOCKS: Number(process.env.L1_REORG_LOOKBACK_BLOCKS),
};
