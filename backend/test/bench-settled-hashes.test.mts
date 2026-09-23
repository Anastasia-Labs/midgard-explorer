import { describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  assertEnoughHashes,
  readSettledHashes,
  type SettledHashes,
} from "../bench/settledHashes.mjs";
import { withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";

/**
 * The real settlement identifiers a benchmark dataset carries.
 *
 * These used to be cloned out of the explorer's own Cardano index, which is
 * decommissioned. They now come from the node's own finalization journal, and
 * three properties have to hold for a benchmark to stay comparable: only
 * submitted blocks count, the order is stable, and a source too short for the
 * profile is refused rather than quietly padded with generated hashes.
 *
 * Against a throwaway database carrying the node's schema, so the assertions
 * are about the query and not about whatever the live node happens to hold.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

const hash28 = (byte: number) => Buffer.from(Array.from({ length: 28 }, () => byte));
const hash32 = (byte: number) => Buffer.from(Array.from({ length: 32 }, () => byte));

const ROOTS = [
  "base_tail_out_ref", "base_tail_datum_cbor", "base_utxos_root",
  "base_transactions_root", "base_deposits_root", "base_withdrawals_root",
  "base_forced_transactions_root", "expected_utxos_root",
  "expected_transactions_root", "expected_deposits_root",
  "expected_withdrawals_root", "expected_forced_transactions_root",
  "expected_transition_trace_root", "expected_event_to_step_root",
];
const COUNTS = [
  "expected_withdrawal_count", "expected_forced_transaction_count",
  "expected_l2_transaction_count", "expected_deposit_count",
  "expected_total_event_count", "expected_transition_step_count",
];

const insertFinalization = async (
  client: Client,
  headerHash: Buffer,
  submitted: Buffer | null,
  lease: string,
) => {
  const columns = [
    "header_hash", "submitted_tx_hash", "block_end_time", "block_start_time",
    "status", "created_at", "updated_at", "state_queue_lease_token",
    "base_snapshot_id", "base_tail_header_hash", "header_cbor",
    ...ROOTS, ...COUNTS,
  ];
  const at = "2026-09-01T10:00:00Z";
  const values = [
    headerHash, submitted, at, at,
    // The node's own vocabulary: a row with no submitted transaction is one it
    // has not sent yet.
    submitted === null ? "pending_submission" : "finalized",
    at, at, lease, "snapshot", hash28(0x00), Buffer.alloc(1),
    ...ROOTS.map(() => "0".repeat(64)),
    ...COUNTS.map(() => 0),
  ];
  await client.query(
    `INSERT INTO pending_block_finalizations (${columns.join(", ")})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    values,
  );
};

/** A URL carrying a password, so the source description is tested against the
 * shape it has to redact rather than one that has nothing to hide. */
const SOURCE_URL = "postgresql://bench:hunter2@127.0.0.1:5433/midgard";

const read = async (seed: (client: Client) => Promise<void>): Promise<SettledHashes> => {
  let result: SettledHashes | null = null;
  await withThrowawayNodeDb(async (client) => {
    await seed(client);
    result = await readSettledHashes(client, SOURCE_URL);
  });
  if (result === null) throw new Error("the throwaway database ran no work");
  return result;
};

db("settled hashes from the node's journal", () => {
  it("takes only blocks the node submitted, in a stable order", async () => {
    const settled = await read(async (client) => {
      // Inserted out of order, so an unordered read would show it.
      await insertFinalization(client, hash28(0x33), hash32(0xcc), "c");
      await insertFinalization(client, hash28(0x11), hash32(0xaa), "a");
      // No submitted transaction: a block the node has not committed.
      await insertFinalization(client, hash28(0x22), null, "b");
    });

    expect(settled.hashes.map((h) => h.toString("hex"))).toEqual([
      "11".repeat(28),
      "33".repeat(28),
    ]);
  }, 60_000);

  it("names its source without the password that reached it", async () => {
    const settled = await read(async (client) => {
      await insertFinalization(client, hash28(0x11), hash32(0xaa), "a");
    });
    expect(settled.source).not.toMatch(/:[^@/]*@/);
    expect(settled.source).toMatch(/@/);
  }, 60_000);

  /** The failure this replaces was silent: a short source produced a dataset
   * that looked identical and settled generated hashes instead of real ones. */
  it("refuses a source too short for the profile, naming both numbers", () => {
    const settled: SettledHashes = {
      source: "bench@127.0.0.1:5433/midgard",
      hashes: [hash28(0x11), hash28(0x22)],
    };
    expect(() => assertEnoughHashes(settled, 9)).toThrow(/has 2 settled header hash/);
    expect(() => assertEnoughHashes(settled, 9)).toThrow(/settles 9 blocks/);
    expect(() => assertEnoughHashes(settled, 2)).not.toThrow();
  });
});
