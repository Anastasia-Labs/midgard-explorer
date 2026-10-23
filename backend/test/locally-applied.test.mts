import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client/index.js";
import { getMetrics } from "../src/db/metrics.js";
import { settlementState } from "../src/db/association.js";
import { getTransaction } from "../src/db/transaction.js";
import { adminUrl, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";
import { insertJournalRow } from "./helpers/journal.mjs";
import type { NodeReader } from "../src/db/consistent.js";

/**
 * `locally_applied`, the node's terminal status for a block it applied.
 *
 * Midgard migration 0011 renamed `finalized` to `locally_applied`: the node
 * applied the block, and whether it is final on Cardano is derived from the L1
 * follower's facts, which the explorer does not read. Every figure that
 * filtered on `finalized` matched nothing, so the tip was null and every
 * applied block counted as pending.
 *
 * Migration 0013 marks a mempool row with the block that includes it, and the
 * node treats only an unmarked row as pending.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

const header = (byte: number) => Buffer.alloc(28, byte);
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const reader = (name: string): { client: PrismaClient; reader: NodeReader } => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl(name) }) });
  return { client, reader: client as unknown as NodeReader };
};

const metricsOf = async (seed: (client: import("pg").Client) => Promise<void>) => {
  let result: Awaited<ReturnType<typeof getMetrics>> | null = null;
  await withThrowawayNodeDb(async (client) => {
    await seed(client);
    const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
    const { client: prisma, reader: read } = reader(name);
    try {
      result = await getMetrics(read);
    } finally {
      await prisma.$disconnect();
    }
  });
  return result!;
};

/** Two applied blocks, one abandoned, and the one active block the schema
 * allows, plus a mempool row a block includes and one nothing includes. */
const chain = async (client: import("pg").Client) => {
  await insertJournalRow(client, { headerHash: header(0x01), status: "locally_applied", endTime: ago(60) });
  await insertJournalRow(client, { headerHash: header(0x02), status: "locally_applied", endTime: ago(30) });
  await insertJournalRow(client, { headerHash: header(0x03), status: "abandoned", endTime: ago(20) });
  await insertJournalRow(client, {
    headerHash: header(0x04),
    status: "observed_waiting_stability",
    endTime: ago(10),
  });
  await client.query(
    `INSERT INTO mempool (tx_id, tx, time_stamp_tz, included_by) VALUES ($1, $2, $3, $4), ($5, $2, $3, NULL)`,
    [Buffer.alloc(32, 0xa1), Buffer.alloc(1), ago(5), header(0x02), Buffer.alloc(32, 0xa2)],
  );
};

db("locally_applied blocks", () => {
  it("make the newest one the tip", async () => {
    const { tip } = await metricsOf(chain);
    expect(tip.headerHash).toBe("02".repeat(28));
  });

  it("count as applied, not as pending", async () => {
    const { finality } = await metricsOf(chain);
    expect(finality.finalized).toBe(2);
    expect(finality.pending).toBe(1);
    expect(finality.abandoned).toBe(1);
    expect(finality.oldestUnsettled?.headerHash).toBe("04".repeat(28));
  });

  it("are the blocks the throughput counts", async () => {
    const { throughput } = await metricsOf(chain);
    expect(throughput.blocks).toBe(2);
  });

  it("leave a mempool row a block includes out of the waiting work", async () => {
    const { waiting } = await metricsOf(chain);
    expect(waiting.transactions).toBe(1);
  });
});

db("a mempool row a block includes", () => {
  /** The row stays in the mempool, marked, until the block's fold is final, so
   * finding it there does not make it merely accepted. */
  it("is reported as in a block, not as waiting", async () => {
    await withThrowawayNodeDb(async (client) => {
      await chain(client);
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const marked = await getTransaction("a1".repeat(32), read);
        expect(marked).toMatchObject({ source: "mempool", inBlock: true, pending: false });
        const unmarked = await getTransaction("a2".repeat(32), read);
        expect(unmarked).toMatchObject({ source: "mempool", inBlock: false, pending: true });
      } finally {
        await prisma.$disconnect();
      }
    });
  });
});

describe("the settlement state of a locally applied block", () => {
  it("is the node's own status, not unknown", () => {
    expect(settlementState("locally_applied")).toBe("locally_applied");
  });
});
