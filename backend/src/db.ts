import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client";
import { config } from "./config";
import { boundedPoolConfig } from "./db/pool";
import { instrumentAdapter } from "./telemetry/instrumentAdapter";

// Prefer a streaming replica when one is configured. The fallback preserves a
// small local deployment, while REQUIRE_MIDGARD_READ_REPLICA lets production
// refuse to start if it would accidentally put explorer traffic on the node's
// primary database.
export const midgardReadUrl =
  config.MIDGARD_READ_REPLICA_URL ?? config.POSTGRES_URL;

let client: PrismaClient | null = null;

const create = (): PrismaClient => {
  if (config.L2_SOURCE !== "replica" || midgardReadUrl === undefined) {
    throw new Error(`the ${config.L2_SOURCE} source reads no database`);
  }
  const adapter = instrumentAdapter(
    new PrismaPg(
      boundedPoolConfig({
        connectionString: midgardReadUrl,
        max: config.NODE_DB_POOL_MAX,
        connectionTimeoutMs: config.DB_CONNECTION_TIMEOUT_MS,
        idleTimeoutMs: config.DB_IDLE_TIMEOUT_MS,
        statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
        applicationName: "midgard-explorer-node-reader",
        readOnly: true,
      }),
    ),
    "node",
  );
  return new PrismaClient({ adapter });
};

/**
 * The node database client, built on first use.
 *
 * Every replica route imports this, and the public source imports those
 * routes' modules without calling them, so building the client at import
 * would make a process with no database settings construct one anyway. A
 * call from the public source throws instead of connecting anywhere.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    client ??= create();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Closes the client if one was built. */
export const disconnectPrisma = async (): Promise<void> => {
  if (client !== null) await client.$disconnect();
};
