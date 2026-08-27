import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client";
import { config } from "./config";
import { boundedPoolConfig } from "./db/pool";

// Prefer a streaming replica when one is configured. The fallback preserves a
// small local deployment, while REQUIRE_MIDGARD_READ_REPLICA lets production
// refuse to start if it would accidentally put explorer traffic on the node's
// primary database.
export const midgardReadUrl =
  config.MIDGARD_READ_REPLICA_URL ?? config.POSTGRES_URL;

const adapter = new PrismaPg(
  boundedPoolConfig({
    connectionString: midgardReadUrl,
    max: config.NODE_DB_POOL_MAX,
    connectionTimeoutMs: config.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: config.DB_IDLE_TIMEOUT_MS,
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
    applicationName: "midgard-explorer-node-reader",
    readOnly: true,
  }),
);
export const prisma = new PrismaClient({ adapter });
