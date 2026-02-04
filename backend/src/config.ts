import { Config } from "./types";
import * as dotenv from "dotenv";

dotenv.config();

export const config: Config = {
  BACKEND_PORT: Number(process.env.BACKEND_PORT),
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
};
