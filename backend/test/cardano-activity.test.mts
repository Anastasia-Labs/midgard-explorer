import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client/index.js";
import {
  ACTIVITY_KINDS,
  getCardanoActivityPage,
  getCardanoActivitySummary,
  getCardanoReferences,
} from "../src/db/cardanoActivity.js";
import { adminUrl, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";
import type { NodeReader } from "../src/db/consistent.js";

/**
 * Midgard's Cardano footprint, read from the node's own tables.
 *
 * This replaced an explorer-owned chain index, so the property under test is
 * not only that the rows come back: it is that all four kinds of record reach
 * one list, in one order, with the identifiers a page needs to link them back
 * to the Midgard record they belong to. A union that silently dropped a kind
 * would look exactly like a deployment that had none of that kind.
 *
 * Against a throwaway database carrying the node's schema, so the fixture is
 * the test's own and an empty or busy live node cannot change the answer.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

const hex = (byte: number, length = 32) =>
  Buffer.from(Array.from({ length }, () => byte));

/**
 * A finalization row.
 *
 * The node's table demands 28 columns this test has no opinion about: base and
 * expected Merkle roots, counts, a lease token, a header CBOR. They are filled
 * with placeholders rather than listed at each call site, so a case reads as
 * the two facts it is about — which hash, and when the node recorded it.
 */
const insertFinalization = async (
  client: import("pg").Client,
  row: {
    headerHash: Buffer;
    submitted: Buffer | null;
    status: string;
    endTime: string;
    updatedAt: string;
    lease: string;
  },
) => {
  const roots = [
    "base_tail_out_ref", "base_tail_datum_cbor", "base_utxos_root",
    "base_transactions_root", "base_deposits_root", "base_withdrawals_root",
    "base_forced_transactions_root", "expected_utxos_root",
    "expected_transactions_root", "expected_deposits_root",
    "expected_withdrawals_root", "expected_forced_transactions_root",
    "expected_transition_trace_root", "expected_event_to_step_root",
  ];
  const counts = [
    "expected_withdrawal_count", "expected_forced_transaction_count",
    "expected_l2_transaction_count", "expected_deposit_count",
    "expected_total_event_count", "expected_transition_step_count",
  ];
  const columns = [
    "header_hash", "submitted_tx_hash", "block_end_time", "block_start_time",
    "status", "created_at", "updated_at", "state_queue_lease_token",
    "base_snapshot_id", "base_tail_header_hash", "header_cbor",
    ...roots, ...counts,
  ];
  const values = [
    row.headerHash, row.submitted, row.endTime, row.endTime, row.status,
    row.endTime, row.updatedAt, row.lease, "snapshot", hex(0x00, 28),
    Buffer.alloc(1),
    // The roots are constrained to 64 hex characters, so a placeholder has to
    // be shaped like a root even where nothing reads it.
    ...roots.map(() => "0".repeat(64)),
    ...counts.map(() => 0),
  ];
  await client.query(
    `INSERT INTO pending_block_finalizations (${columns.join(", ")})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    values,
  );
};

/** One record of each kind, at four distinct times. */
const seed = async (client: import("pg").Client) => {
  await insertFinalization(client, {
    headerHash: hex(0x11, 28),
    submitted: hex(0xaa),
    status: "finalized",
    endTime: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:05:00Z",
    lease: "lease",
  });
  // A block the node queued and has not submitted: no hash, so no activity row.
  await insertFinalization(client, {
    headerHash: hex(0x12, 28),
    submitted: null,
    status: "pending_submission",
    endTime: "2026-09-01T11:00:00Z",
    updatedAt: "2026-09-01T11:00:00Z",
    lease: "lease-2",
  });
  await client.query(
    `INSERT INTO deposits_utxos
       (event_id, event_info, inclusion_time, deposit_l1_tx_hash, ledger_tx_id,
        ledger_output, ledger_address, projected_header_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'addr_test1', $7, 'consumed')`,
    [hex(0x21), Buffer.alloc(1), "2026-09-01T09:00:00Z", hex(0xbb), hex(0x22),
     Buffer.alloc(1), hex(0x11, 28)],
  );
  const blob = Buffer.alloc(1);
  await client.query(
    `INSERT INTO withdrawal_utxos
       (event_id, raw_event_info, inclusion_time, withdrawal_l1_tx_hash,
        withdrawal_l1_output_index, asset_name, l2_outref, l2_owner, l2_value,
        l1_address, l1_datum, refund_address, refund_datum, validity, status,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, 2, $5, $5, $6, $5, $5, $5, $5, $5,
             NULL, 'awaiting', $3, $3)`,
    // The table constrains these: a 32-byte hash, a 28-byte owner, an asset
    // name of 1 to 32 bytes, and `awaiting` with no projected header.
    [hex(0x31), blob, "2026-09-01T08:00:00Z", hex(0xcc), blob, hex(0x32, 28)],
  );
  await client.query(
    `INSERT INTO forced_transaction_utxos
       (tx_order_id, tx_order_l1_tx_hash, tx_order_l1_output_index, asset_name,
        raw_datum, tx_id, tx_compact, forced_inclusion_value, operator_validity,
        inclusion_time, status, created_at, updated_at)
     VALUES ($1, $2, 0, $3, $3, $4, $3, $3, 'TxIsValid', $5, 'awaiting', $5, $5)`,
    [hex(0x41), hex(0xdd), blob, hex(0x42), "2026-09-01T07:00:00Z"],
  );
};

const reader = (name: string): { client: PrismaClient; reader: NodeReader } => {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl(name) }),
  });
  return { client, reader: client as unknown as NodeReader };
};

db("cardano activity, from the node's records", () => {
  it("brings every kind into one list, newest first", async () => {
    await withThrowawayNodeDb(async (client) => {
      await seed(client);
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const page = await getCardanoActivityPage(1, read);
        expect(page.rows.map((row) => row.kind)).toEqual([
          "settlement",
          "deposit",
          "withdrawal",
          "forced_transaction",
        ]);
        expect(page.total).toBe(4);
        expect(page.hasNextPage).toBe(false);
        // Descending, and the settlement is ordered by when the NODE recorded
        // the transition rather than by the block's own window.
        const times = page.rows.map((row) => row.recordedAt);
        expect([...times].sort().reverse()).toEqual(times);
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  /** A queued block with no submitted hash is not Cardano activity. Listing it
   * would put an empty transaction column on the page and imply the node had
   * done something on chain. */
  it("leaves out a block the node has not submitted", async () => {
    await withThrowawayNodeDb(async (client) => {
      await seed(client);
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const page = await getCardanoActivityPage(1, read);
        expect(page.rows.filter((row) => row.kind === "settlement")).toHaveLength(1);
        expect(page.rows.every((row) => row.l1TxHash.length === 64)).toBe(true);
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  it("carries the identifiers a page needs to link back to the Midgard record", async () => {
    await withThrowawayNodeDb(async (client) => {
      await seed(client);
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const rows = (await getCardanoActivityPage(1, read)).rows;
        const settlement = rows.find((row) => row.kind === "settlement");
        expect(settlement?.headerHash).toBe("11".repeat(28));
        expect(settlement?.status).toBe("finalized");
        const deposit = rows.find((row) => row.kind === "deposit");
        expect(deposit?.recordId).toBe("21".repeat(32));
        // The header a bridge event was projected into, when the node has set
        // one, so a deposit can link to the block that carries it.
        expect(deposit?.headerHash).toBe("11".repeat(28));
        expect(rows.find((row) => row.kind === "withdrawal")?.outputIndex).toBe(2);
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  it("counts every kind, including the ones with nothing in them", async () => {
    await withThrowawayNodeDb(async (client) => {
      await seed(client);
      await client.query("DELETE FROM forced_transaction_utxos");
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const summary = await getCardanoActivitySummary(read);
        expect(summary.byKind.map((k) => k.kind)).toEqual([...ACTIVITY_KINDS]);
        expect(summary.total).toBe(3);
        const forced = summary.byKind.find((k) => k.kind === "forced_transaction");
        // Present and empty, rather than absent: a kind that disappears when it
        // has no rows reads as a kind this deployment does not have.
        expect(forced?.count).toBe(0);
        expect(forced?.newestRecordedAt).toBeNull();
        expect(summary.newestRecordedAt).toBe("2026-09-01T10:05:00.000Z");
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  it("finds every Midgard record that names one transaction", async () => {
    await withThrowawayNodeDb(async (client) => {
      await seed(client);
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const { client: prisma, reader: read } = reader(name);
      try {
        const found = await getCardanoReferences("bb".repeat(32), read);
        expect(found).toHaveLength(1);
        expect(found[0]?.kind).toBe("deposit");
        // A hash no Midgard record names is an empty answer, not an error and
        // not a statement about whether the transaction exists on Cardano.
        expect(await getCardanoReferences("ee".repeat(32), read)).toEqual([]);
      } finally {
        await prisma.$disconnect();
      }
    });
  });
});
