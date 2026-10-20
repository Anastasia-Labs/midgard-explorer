import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../prisma/explorer-client/index.js";
import { getBlockFinalization } from "../src/db/block.js";
import { SETTLED_CHAIN, settlementStatus } from "../src/db/settlement.js";
import { adminUrl, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";
import type { NodeReader } from "../src/db/consistent.js";

/**
 * Where an applied block stands, from the follower's facts.
 *
 * The node writes `locally_applied` and never "final"; finality is derived.
 * The chain here is G <- A <- B <- C <- D, all applied by this node:
 *
 *   A  an ancestor of the confirmed header, its merge record pruned: finalized
 *   B  the confirmed header, its merge still undoable:                merged
 *   C  in the state queue:                                            waiting_to_merge
 *   D  applied, not landed yet (the follower lags):                   unknown
 *
 * D is the case that must never read as merged. Times are stamped against the
 * links, so a derivation that used them would fail.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

const header = (n: number) => Buffer.alloc(28, n);
const root = "0".repeat(64);
const [G, A, B, C, D, E] = [1, 2, 3, 4, 5, 6];

const journal = async (
  client: import("pg").Client,
  hash: number,
  parent: number,
  status: string,
  at: string,
) => {
  const roots = [
    "base_tail_out_ref",
    "base_tail_datum_cbor",
    "base_utxos_root",
    "base_transactions_root",
    "base_deposits_root",
    "base_withdrawals_root",
    "base_forced_transactions_root",
    "expected_utxos_root",
    "expected_transactions_root",
    "expected_deposits_root",
    "expected_withdrawals_root",
    "expected_forced_transactions_root",
    "expected_transition_trace_root",
    "expected_event_to_step_root",
  ];
  const counts = [
    "expected_withdrawal_count",
    "expected_forced_transaction_count",
    "expected_l2_transaction_count",
    "expected_deposit_count",
    "expected_total_event_count",
    "expected_transition_step_count",
  ];
  const columns = [
    "header_hash",
    "block_end_time",
    "block_start_time",
    "status",
    "state_queue_lease_token",
    "base_snapshot_id",
    "base_tail_header_hash",
    "header_cbor",
    "consensus_profile_id",
    "format_version",
    "replay_kind",
    "deployment_marker_schema_version",
    "deployment_manifest_id",
    "expected_validation_traces_root",
    "expected_validation_trace_count",
    "ledger_delta_spent",
    "ledger_delta_produced",
    "block_time",
    ...roots,
    ...counts,
  ];
  const values = [
    header(hash),
    at,
    at,
    status,
    `lease-${hash}`,
    "snapshot",
    header(parent),
    Buffer.alloc(1),
    "midgard-consensus-v1",
    1,
    "ledger_delta_v1",
    "midgard-deployment-marker-v1",
    root,
    "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8",
    0,
    "[]",
    "[]",
    at,
    ...roots.map(() => root),
    ...counts.map(() => 0),
  ];
  await client.query(
    `INSERT INTO pending_block_finalizations (${columns.join(", ")})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    values,
  );
};

const merge = (client: import("pg").Client, hash: number, parent: number) =>
  client.query(
    `INSERT INTO node_confirmed_merges
       (header_hash, parent_header_hash, parent_utxos_root, utxos_root, kind, applied,
        spent, produced_outrefs, produced_outputs, deposit_ids, withdrawals, forced_ids,
        tx_ids, consumed_deposit_ids, finalized_withdrawal_ids, finalized_forced_ids)
     VALUES ($1, $2, $3, $3, 'own', true, '{}', '{}', '{}', '{}', '[]', '{}', '{}', '{}', '{}', '{}')`,
    [header(hash), header(parent), root],
  );

const land = (client: import("pg").Client, hash: number, parent: number) =>
  client.query(
    `INSERT INTO node_landed_blocks
       (header_hash, parent_header_hash, parent_utxos_root, utxos_root, kind, state, applied,
        spent, produced_outrefs, produced_outputs, deposit_ids, withdrawals, forced_ids, tx_ids)
     VALUES ($1, $2, $3, $3, 'own', 'processed', true, '{}', '{}', '{}', '{}', '[]', '{}', '{}')`,
    [header(hash), header(parent), root],
  );

const confirm = (client: import("pg").Client, hash: number) =>
  client.query(
    `INSERT INTO node_confirmed_ledger_frontier (header_hash, utxos_root) VALUES ($1, $2)`,
    [header(hash), root],
  );

const withReader = async (
  client: import("pg").Client,
  work: (reader: NodeReader & PrismaClient) => Promise<void>,
) => {
  const name = (await client.query("SELECT current_database() AS db")).rows[0]
    .db;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl(name) }),
  });
  try {
    await work(prisma as unknown as NodeReader & PrismaClient);
  } finally {
    await prisma.$disconnect();
  }
};

const statuses = async (reader: PrismaClient) => {
  const rows = await reader.$queryRaw<
    Array<{ h: Uint8Array; s: string }>
  >(Prisma.sql`
    WITH RECURSIVE ${SETTLED_CHAIN}
    SELECT f.header_hash AS h, ${settlementStatus("f")} AS s
      FROM pending_block_finalizations AS f`);
  return Object.fromEntries(rows.map((r) => [Buffer.from(r.h)[0]!, r.s]));
};

db("the settlement status of an applied block", () => {
  it("is derived from the queue, the merges and ancestry, never from time", async () => {
    await withThrowawayNodeDb(async (client) => {
      // Newest first in time, oldest last: the reverse of the links.
      await journal(client, A, G, "locally_applied", "2026-10-20T12:00:00Z");
      await journal(client, B, A, "locally_applied", "2026-10-20T11:00:00Z");
      await journal(client, C, B, "locally_applied", "2026-10-20T10:00:00Z");
      await journal(client, D, C, "locally_applied", "2026-10-20T09:00:00Z");
      await journal(
        client,
        E,
        D,
        "submitted_unconfirmed",
        "2026-10-20T08:00:00Z",
      );
      await merge(client, B, A);
      await confirm(client, B);
      await land(client, C, B);
      await withReader(client, async (reader) => {
        expect(await statuses(reader)).toEqual({
          [A]: "finalized",
          [B]: "merged",
          [C]: "waiting_to_merge",
          [D]: "locally_applied",
          [E]: "submitted_unconfirmed",
        });
        expect(
          await getBlockFinalization(header(A).toString("hex"), reader),
        ).toMatchObject({
          finalization: { status: "finalized" },
          journalStatus: "locally_applied",
        });
      });
    });
  });

  it("claims nothing final before the first merge", async () => {
    await withThrowawayNodeDb(async (client) => {
      await journal(client, A, G, "locally_applied", "2026-10-20T12:00:00Z");
      await withReader(client, async (reader) => {
        expect(await statuses(reader)).toEqual({ [A]: "locally_applied" });
      });
    });
  });

  /** Only this node's own blocks have a journal row, so a foreign block is
   * crossed only while its merge record is retained. Once the node prunes it,
   * the own blocks behind it fall back to unknown: the walk never guesses past
   * a link it cannot read. A known limit, pinned here so it is not mistaken for
   * a regression, and so a fix that reads foreign links has a case to turn. */
  it("stops at a foreign block whose merge record was pruned", async () => {
    const F = 7;
    for (const pruned of [false, true]) {
      await withThrowawayNodeDb(async (client) => {
        await journal(client, A, G, "locally_applied", "2026-10-20T12:00:00Z");
        await journal(client, C, F, "locally_applied", "2026-10-20T11:00:00Z");
        if (!pruned) await merge(client, F, A);
        await confirm(client, C);
        await withReader(client, async (reader) => {
          expect(
            await statuses(reader),
            pruned ? "pruned" : "retained",
          ).toEqual({
            [A]: pruned ? "locally_applied" : "finalized",
            [C]: "finalized",
          });
        });
      });
    }
  });

  it("ends the ancestry walk on a cycle instead of looping", async () => {
    await withThrowawayNodeDb(async (client) => {
      await journal(client, A, B, "locally_applied", "2026-10-20T12:00:00Z");
      await journal(client, B, A, "locally_applied", "2026-10-20T11:00:00Z");
      await confirm(client, B);
      await withReader(client, async (reader) => {
        expect(await statuses(reader)).toEqual({
          [A]: "finalized",
          [B]: "finalized",
        });
      });
    });
  });
});
