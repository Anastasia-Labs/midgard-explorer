import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client/index.js";
import { getStateQueue, QUEUE_HEAD, QUEUE_TAIL } from "../src/db/stateQueue.js";
import { adminUrl, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";
import type { NodeReader } from "../src/db/consistent.js";

/**
 * The state queue, read from the node's follower tables.
 *
 * The queue is a linked list, so what matters is that the order shown comes
 * from the links: walked from the confirmed header, never sorted by time. The
 * rows here are inserted out of order and stamped with times that disagree
 * with the links, so a query that sorted instead of walking would fail.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

const header = (n: number) => Buffer.alloc(28, n);
const root = "0".repeat(64);

const land = async (
  client: import("pg").Client,
  row: { hash: number; parent: number; at: string; state?: string; txs?: number; kind?: string },
) => {
  const txIds = Array.from({ length: row.txs ?? 0 }, (_, i) => Buffer.alloc(32, i + 1));
  await client.query(
    `INSERT INTO node_landed_blocks
       (header_hash, parent_header_hash, parent_utxos_root, utxos_root, kind, state,
        applied, spent, produced_outrefs, produced_outputs, deposit_ids, withdrawals,
        forced_ids, tx_ids, processed_at)
     VALUES ($1, $2, $3, $3, $4, $5, true, '{}', '{}', '{}', '{}', '[{}]', '{}', $6, $7)`,
    [header(row.hash), header(row.parent), root, row.kind ?? "own", row.state ?? "processed", txIds, row.at],
  );
};

const confirm = (client: import("pg").Client, hash: number) =>
  client.query(
    `INSERT INTO node_confirmed_ledger_frontier (header_hash, utxos_root, updated_at)
     VALUES ($1, $2, '2026-10-20T08:00:00Z')`,
    [header(hash), root],
  );

/** A commit journal row; only the hash, status and time matter here. */
const commit = async (client: import("pg").Client, hash: number, status: string, at: string) => {
  const roots = [
    "base_tail_out_ref", "base_tail_datum_cbor", "base_utxos_root", "base_transactions_root",
    "base_deposits_root", "base_withdrawals_root", "base_forced_transactions_root",
    "expected_utxos_root", "expected_transactions_root", "expected_deposits_root",
    "expected_withdrawals_root", "expected_forced_transactions_root",
    "expected_transition_trace_root", "expected_event_to_step_root",
  ];
  const counts = [
    "expected_withdrawal_count", "expected_forced_transaction_count",
    "expected_l2_transaction_count", "expected_deposit_count",
    "expected_total_event_count", "expected_transition_step_count",
  ];
  const columns = [
    "header_hash", "block_end_time", "block_start_time", "status", "state_queue_lease_token",
    "base_snapshot_id", "base_tail_header_hash", "header_cbor", "consensus_profile_id",
    "format_version", "replay_kind", "deployment_marker_schema_version",
    "deployment_manifest_id", "expected_validation_traces_root",
    "expected_validation_trace_count", "ledger_delta_spent", "ledger_delta_produced",
    "block_time", ...roots, ...counts,
  ];
  const values = [
    header(hash), at, at, status, `lease-${hash}`, "snapshot", header(0), Buffer.alloc(1),
    "midgard-consensus-v1", 1, "ledger_delta_v1", "midgard-deployment-marker-v1", root,
    "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8", 0, "[]", "[]", at,
    ...roots.map(() => root), ...counts.map(() => 0),
  ];
  await client.query(
    `INSERT INTO pending_block_finalizations (${columns.join(", ")})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    values,
  );
};

const read = async (client: import("pg").Client, maturityMs: number | null = null) => {
  const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl(name) }) });
  try {
    return await getStateQueue(prisma as unknown as NodeReader, maturityMs);
  } finally {
    await prisma.$disconnect();
  }
};

const hex = (n: number) => header(n).toString("hex");

db("the state queue", () => {
  it("walks the links from the confirmed header, whatever the times say", async () => {
    await withThrowawayNodeDb(async (client) => {
      await confirm(client, 1);
      // Inserted, and stamped, in the opposite order to the links.
      await land(client, { hash: 4, parent: 3, at: "2026-10-20T09:00:00Z" });
      await land(client, { hash: 3, parent: 2, at: "2026-10-20T09:30:00Z", txs: 2 });
      await land(client, { hash: 2, parent: 1, at: "2026-10-20T10:00:00Z", kind: "foreign" });
      const q = await read(client);
      expect(q.confirmed?.headerHash).toBe(hex(1));
      expect([...q.oldest, ...q.newest].map((b) => b.headerHash)).toEqual([hex(2), hex(3), hex(4)]);
      expect(q.depth).toBe(3);
      expect(q.linked).toBe(3);
      expect(q.hidden).toBe(0);
      expect(q.oldest[0]!.origin).toBe("foreign");
      expect(q.oldest[1]!.transactions).toBe(2);
      expect(q.oldest[0]!.withdrawals).toBe(1);
      expect(q.oldest[0]!.parentHeaderHash).toBe(hex(1));
      // Another operator's block, so this node holds no commit for it.
      expect(q.oldest[0]).toMatchObject({ blockTime: null, commitTxHash: null });
    });
  });

  it("lists the oldest and newest of a long queue and counts the rest", async () => {
    await withThrowawayNodeDb(async (client) => {
      await confirm(client, 1);
      const length = QUEUE_HEAD + QUEUE_TAIL + 5;
      for (let i = 0; i < length; i++) {
        await land(client, { hash: i + 2, parent: i + 1, at: "2026-10-20T09:00:00Z" });
      }
      const q = await read(client);
      expect(q.oldest.map((b) => b.headerHash)).toEqual(
        Array.from({ length: QUEUE_HEAD }, (_, i) => hex(i + 2)),
      );
      expect(q.newest.at(-1)!.headerHash).toBe(hex(length + 1));
      expect(q.newest).toHaveLength(QUEUE_TAIL);
      expect(q.hidden).toBe(5);
      expect(q.linked).toBe(length);
    });
  });

  it("starts at the unqueued parent before the first merge", async () => {
    await withThrowawayNodeDb(async (client) => {
      await land(client, { hash: 3, parent: 2, at: "2026-10-20T09:00:00Z" });
      await land(client, { hash: 2, parent: 9, at: "2026-10-20T09:00:00Z" });
      const q = await read(client);
      expect(q.confirmed).toBeNull();
      expect(q.oldest.map((b) => b.headerHash)).toEqual([hex(2), hex(3)]);
    });
  });

  it("links nothing when the graph has two starts, rather than picking one", async () => {
    await withThrowawayNodeDb(async (client) => {
      await land(client, { hash: 2, parent: 8, at: "2026-10-20T09:00:00Z" });
      await land(client, { hash: 3, parent: 9, at: "2026-10-20T09:00:00Z" });
      const q = await read(client);
      expect(q.depth).toBe(2);
      expect(q.linked).toBe(0);
      expect(q.oldest).toEqual([]);
    });
  });

  it("counts removed headers apart and keeps them out of the order", async () => {
    await withThrowawayNodeDb(async (client) => {
      await confirm(client, 1);
      await land(client, { hash: 2, parent: 1, at: "2026-10-20T09:00:00Z" });
      await land(client, { hash: 7, parent: 2, at: "2026-10-20T09:00:00Z", state: "removed" });
      const q = await read(client);
      expect(q.removed).toBe(1);
      expect(q.removedBlocks.map((b) => b.headerHash)).toEqual([hex(7)]);
      expect(q.depth).toBe(1);
      expect([...q.oldest, ...q.newest].map((b) => b.headerHash)).toEqual([hex(2)]);
    });
  });

  it("shows this node's commit until it lands", async () => {
    await withThrowawayNodeDb(async (client) => {
      await confirm(client, 1);
      await land(client, { hash: 2, parent: 1, at: "2026-10-20T09:00:00Z" });
      await commit(client, 2, "locally_applied", "2026-10-20T08:50:00Z");
      await commit(client, 7, "abandoned", "2026-10-20T09:05:00Z");
      const landed = await read(client, 900_000);
      expect(landed.committing).toBeNull();
      // This node's own block: its commit time from the journal, for maturity.
      expect(landed.oldest[0]!.blockTime).toBe("2026-10-20T08:50:00.000Z");
      expect(landed.maturityMs).toBe(900_000);
      await commit(client, 5, "submitted_unconfirmed", "2026-10-20T09:10:00Z");
      expect((await read(client)).committing).toMatchObject({
        headerHash: hex(5),
        status: "submitted_unconfirmed",
      });
    });
  });

  it("reads an empty queue as empty, not as missing", async () => {
    await withThrowawayNodeDb(async (client) => {
      const q = await read(client);
      expect(q).toMatchObject({ confirmed: null, depth: 0, linked: 0, hidden: 0, removed: 0 });
      expect(q.oldest).toEqual([]);
      expect(q.committing).toBeNull();
    });
  });
});
