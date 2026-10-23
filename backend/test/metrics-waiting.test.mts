import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client/index.js";
import { getMetrics } from "../src/db/metrics.js";
import { adminUrl, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";
import type { NodeReader } from "../src/db/consistent.js";

/**
 * Work the node has not put in a block yet.
 *
 * The node makes a block only when something is waiting: a transaction in the
 * mempool, or a deposit, withdrawal or forced transaction whose inclusion time
 * has passed and that no header carries yet. An old tip with nothing waiting is
 * a quiet chain; an old tip with work waiting is a stalled one. This figure is
 * what tells the two apart, so it has to count what the node counts.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

const hex = (byte: number, length = 32) => Buffer.from(Array.from({ length }, () => byte));
const blob = Buffer.alloc(1);

const reader = (name: string): { client: PrismaClient; reader: NodeReader } => {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl(name) }),
  });
  return { client, reader: client as unknown as NodeReader };
};

const insertMempool = (client: import("pg").Client, id: number, at: string) =>
  client.query(`INSERT INTO mempool (tx_id, tx, time_stamp_tz) VALUES ($1, $2, $3)`, [
    hex(id),
    blob,
    at,
  ]);

const insertProcessed = (client: import("pg").Client, id: number, at: string) =>
  client.query(`INSERT INTO processed_mempool (tx_id, tx, time_stamp_tz) VALUES ($1, $2, $3)`, [
    hex(id),
    blob,
    at,
  ]);

const insertDeposit = (
  client: import("pg").Client,
  id: number,
  at: string,
  status: string,
  header: Buffer | null,
) =>
  client.query(
    `INSERT INTO deposits_utxos
       (event_id, event_info, inclusion_time, deposit_l1_tx_hash, ledger_tx_id,
        ledger_output, ledger_address, projected_header_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'addr_test1', $7, $8)`,
    [hex(id), blob, at, hex(id + 1), hex(id + 2), blob, header, status],
  );

const insertWithdrawal = (
  client: import("pg").Client,
  id: number,
  at: string,
  status: string,
) =>
  client.query(
    `INSERT INTO withdrawal_utxos
       (event_id, raw_event_info, inclusion_time, withdrawal_l1_tx_hash,
        withdrawal_l1_output_index, asset_name, l2_outref, l2_owner, l2_value,
        l1_address, l1_datum, refund_address, refund_datum, validity, status,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, $5, $5, $6, $5, $5, $5, $5, $5, NULL, $7, $3, $3)`,
    [hex(id), blob, at, hex(id + 1), blob, hex(id + 2, 28), status],
  );

const insertForced = (client: import("pg").Client, id: number, at: string) =>
  client.query(
    `INSERT INTO forced_transaction_utxos
       (tx_order_id, tx_order_l1_tx_hash, tx_order_l1_output_index, asset_name,
        raw_datum, tx_id, tx_compact, forced_inclusion_value, operator_validity,
        inclusion_time, status, created_at, updated_at)
     VALUES ($1, $2, 0, $3, $3, $4, $3, $3, 'TxIsValid', $5, 'awaiting', $5, $5)`,
    [hex(id), hex(id + 1), blob, hex(id + 2), at],
  );

const past = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

db("waiting work, as the node counts it", () => {
  it("reports nothing waiting on a quiet node", async () => {
    await withThrowawayNodeDb(async (client) => {
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const { waiting } = await getMetrics(read);
        expect(waiting).toMatchObject({
          transactions: 0,
          deposits: 0,
          withdrawals: 0,
          forcedTransactions: 0,
          since: null,
        });
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  it("counts mempool transactions and due bridge events, from the oldest", async () => {
    await withThrowawayNodeDb(async (client) => {
      await insertMempool(client, 0x01, past(3));
      await insertMempool(client, 0x02, past(1));
      await insertDeposit(client, 0x10, past(30), "awaiting", null);
      await insertWithdrawal(client, 0x20, past(90), "awaiting");
      await insertForced(client, 0x30, past(5));
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const { waiting } = await getMetrics(read);
        expect(waiting.transactions).toBe(2);
        expect(waiting.deposits).toBe(1);
        expect(waiting.withdrawals).toBe(1);
        expect(waiting.forcedTransactions).toBe(1);
        // The withdrawal has waited longest, so the wait is measured from it.
        const since = Date.parse(waiting.since ?? "");
        expect(Math.abs(since - Date.parse(past(90)))).toBeLessThan(60_000);
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  /** Neither of these is work the node can do now: one is not due yet, the
   * other is already in a header. Counting them would call a quiet chain
   * stalled. */
  it("leaves out events not yet due and events a header already carries", async () => {
    await withThrowawayNodeDb(async (client) => {
      await insertDeposit(client, 0x10, future(30), "awaiting", null);
      await insertDeposit(client, 0x40, past(30), "projected", hex(0x11, 28));
      await insertWithdrawal(client, 0x20, future(30), "awaiting");
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const { waiting } = await getMetrics(read);
        expect(waiting.deposits).toBe(0);
        expect(waiting.withdrawals).toBe(0);
        expect(waiting.since).toBeNull();
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  /** A skipped submission moves transactions from the mempool into
   * processed_mempool, and the node takes its next block candidates from there
   * first. Missing them would read a stuck node as quiet. */
  it("counts transactions left in processed_mempool, once each", async () => {
    await withThrowawayNodeDb(async (client) => {
      await insertProcessed(client, 0x01, past(40));
      await insertProcessed(client, 0x02, past(10));
      await insertMempool(client, 0x02, past(5));
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const { waiting } = await getMetrics(read);
        expect(waiting.transactions).toBe(2);
        const since = Date.parse(waiting.since ?? "");
        expect(Math.abs(since - Date.parse(past(40)))).toBeLessThan(60_000);
      } finally {
        await prisma.$disconnect();
      }
    });
  });
});
