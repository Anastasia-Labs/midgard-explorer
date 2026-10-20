import type { Client } from "pg";

/**
 * One `pending_block_finalizations` row that satisfies Midgard f4cf28ca1's
 * schema, with every column a test does not care about set to a value of the
 * shape its CHECK constraint demands.
 */
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
/** The validation-trace root the schema requires when a block has no events. */
const EMPTY_VALIDATION_TRACES_ROOT =
  "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8";

export type JournalRow = {
  headerHash: Buffer;
  status: string;
  endTime: string;
  submitted?: Buffer | null;
  updatedAt?: string;
};

export async function insertJournalRow(client: Client, row: JournalRow): Promise<void> {
  const columns: Array<[string, unknown]> = [
    ["header_hash", row.headerHash],
    ["submitted_tx_hash", row.submitted ?? null],
    ["block_end_time", row.endTime],
    ["block_start_time", row.endTime],
    ["block_time", row.endTime],
    ["status", row.status],
    ["created_at", row.endTime],
    ["updated_at", row.updatedAt ?? row.endTime],
    ["state_queue_lease_token", "lease"],
    ["base_snapshot_id", "snapshot"],
    ["base_tail_header_hash", Buffer.alloc(28)],
    ["header_cbor", Buffer.alloc(1)],
    ["consensus_profile_id", "midgard-consensus-v1"],
    ["format_version", 1],
    ["replay_kind", "ledger_delta_v1"],
    ["deployment_marker_schema_version", "midgard-deployment-marker-v1"],
    ["deployment_manifest_id", "0".repeat(64)],
    ["expected_validation_traces_root", EMPTY_VALIDATION_TRACES_ROOT],
    ["expected_validation_trace_count", 0],
    ["ledger_delta_spent", "[]"],
    ["ledger_delta_produced", "[]"],
    ...ROOTS.map((name): [string, unknown] => [name, "0".repeat(64)]),
    ...COUNTS.map((name): [string, unknown] => [name, 0]),
  ];
  await client.query(
    `INSERT INTO pending_block_finalizations (${columns.map(([name]) => name).join(", ")})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    columns.map(([, value]) => value),
  );
}
