# Coverage scope: which node information the explorer exposes

Measured 2026-09-04 against the live node database (`midgard-node-postgres-1`, database `midgard`) and the explorer source at `wip/dev-onboarding`.

Updated 2026-10-19 for the schema of Midgard `f4cf28ca1` (migrations 0001 to 0027), which the explorer pins. The 54 columns those migrations added are recorded as `not-read` and `defer` until each one is assessed. Seven records left with columns the schema no longer has: `forced_transaction_utxos.operator_validity` (dropped), the four `pending_block_finalization_utxos` columns (table dropped), and `tx_admissions.tx_canonical_cbor` and `tx_canonical_cbor_sha256`, which moved to `tx_admission_payloads`. Six of those seven had been adopted.

This document governs what the benchmark datasets seed and what "product at 10/10" checks. **Every column in the node's public schema carries exactly one status**: already exposed, adopt, defer, or exclude.

## Method, and why the first attempt was wrong

The inventory is generated from `information_schema.columns`, then annotated. It is not hand-written. Two earlier attempts in this project failed the same way, and both failures are worth recording because the method exists to prevent them:

1. **A hand-written candidate list silently omits fields.** The first draft of this document listed columns gathered by ad-hoc exploration and missed `base_tail_datum_cbor`, seven `withdrawal_utxos` columns, three `forced_transaction_utxos` columns, the provenance triple on six member tables, and four `tx_admissions` columns.
2. **A bare column-name grep produces false "already exposed" results.** `l2_owner`, `l1_datum`, `refund_address` and `refund_datum` matched `backend/src/indexer/userEventDatum.ts`, which decodes L1 event datums and never reads `withdrawal_utxos`. `asset_name` matched the Cardano native-asset code. Name collisions across unrelated modules.

3. **A file-scoped grep credits one table's columns to every table that file queries.** `backend/src/db/block.ts` selects `payload_cbor` for `pending_block_finalization_txs`, and separately queries the deposits, withdrawals and forced-transaction member tables selecting only `member_id, ordinal, source_time_stamp_tz` (`block.ts:265-280`). File scope falsely marked `payload_cbor` exposed on all four. Same for `da_payloads`, whose query at `block.ts:208-213` selects seven root columns and omits `payload_cbor`, `version`, `payload_sha256`, `created_at`, `updated_at`.

The annotation is therefore **scoped to the individual SQL statement**, with alias resolution:

Schema from `information_schema.columns`. Then every backtick template literal containing `SELECT` is extracted from `backend/src/**/*.ts`; per statement, `FROM`/`JOIN` build an alias map (CTE names excluded); a qualified reference `alias.col` attributes to that alias's table; an unqualified reference attributes only when the statement names exactly one table, and is reported `AMBIGUOUS` otherwise. Detector at `/tmp/claude-1000/detect.py`; it should move into the repo as a lint before this document is trusted again.

**Historical, superseded.** The first statement-scoped run reported 108 selected / 92 not-read / 8 ambiguous. It scanned whole statements, so a column used only in `WHERE`, `JOIN` or `ORDER BY` counted as selected. The current detector is **projection-scoped**: it pairs each `SELECT` with its `FROM`, attributes only the projection list, and separates `PROJECTED` from `REFERENCED-ONLY`. The eight ambiguous cases were resolved by reading the statements (UNION branches over a single table each, `ledger.ts:25-27` and `address.ts:64-75`, `126-128`) and all eight are projected. See "Audit result" below for the current model.

The statement-scoped set is a strict superset of the file-scoped one: nothing previously reported as a gap was withdrawn, ten more were added.

Type-aware sizing. **Never `octet_length(col::text)` on `bytea`**: it returns hex and inflates by `2n+2`.

```
bytea -> octet_length(col)     text -> octet_length(col)     jsonb -> pg_column_size(col)
```

**Caveat on every size below.** Row counts are 0 to 108. These are maxima over tiny samples, not distributions. Every delivery verdict marked *provisional* must be re-measured at the `target` profile before it is final. Synthetic seed data can establish functional coverage and protocol-bound minimums; it cannot establish a production p99.

## Audit result

Generated from `docs/coverage-manifest.json`, which is the source of truth for both this table and the plan it governs. Do not hand-edit either the counts or the per-table tables below: regenerate.

| Status | Count | Meaning |
|---|---:|---|
| `rendered-presence-verified` | **113** | A field of this name or recorded alias exists at query, API, contract, render and test layers. **The path is not individually traced** |
| `raw-and-transformed-rendered` | **4** | Emitted raw on the detail route and also decoded |
| `transformed-rendered` | **7** | Consumed by a decoder and represented as a semantic value; the raw bytes are never emitted |
| `referenced-only` | **10** | In `WHERE`/`JOIN`/`ORDER BY`, never returned |
| `not-read` | **151** | No statement projects or references it |
| | **285** | in-scope columns |

Projected: **120**. Gaps: **161**. No column is `queried-only` or `contracted-not-rendered`.

### Decisions across the 161 gaps

| Decision | Count |
|---|---:|
| adopt | **59** |
| defer | **97** |
| exclude | **5** |

**59 adopted columns** remain gaps. `DATASETS` was built against the 77 adopted on 2026-09-04, which include the twelve Merkle roots exposed since. Earlier revisions said 82; that came from a file-scoped detector and conflated gaps with adoptions.

### The decoded set

Eleven columns are decoded or counted rather than passed through. Four of them are **also** emitted raw, so they carry a different status.

**`raw-and-transformed-rendered` (4).** `routes/transaction.ts:69-70` calls `decodeTransaction(txRow.tx, ..., { includeCbor: true })`; `decode/transaction.ts:508-512` emits `cborHex`, capped at `MAX_INLINE_CBOR_BYTES` (64 KB) with `cborTruncated: true` past the cap; `contracts/src/transaction-view.ts:187-190` carries both; the Raw tab renders it at `app/src/app/transaction/[txHash]/page.tsx:265-267`. The list paths (`address.ts:46`, `block.ts:105`, `transaction.ts:253`) call `decodeTransactionSafe` **without** `includeCbor`, so they emit no raw bytes.

| Column | Path |
|---|---|
| `processed_mempool.tx` | `tx` / `payload_cbor` -> `txRow.tx` -> `cborHex` (64 KB cap, `cborTruncated`) |
| `pending_block_finalization_txs.payload_cbor` | `tx` / `payload_cbor` -> `txRow.tx` -> `cborHex` (64 KB cap, `cborTruncated`) |
| `mempool.tx` | `tx` / `payload_cbor` -> `txRow.tx` -> `cborHex` (64 KB cap, `cborTruncated`) |
| `immutable.tx` | `tx` / `payload_cbor` -> `txRow.tx` -> `cborHex` (64 KB cap, `cborTruncated`) |
| `confirmed_ledger.output` | computeBalance / codec.decodeMidgardTxOutput |
| `deposits_utxos.ledger_output` | computeBalance -> `value` |
| `mempool_ledger.output` | computeBalance / codec.decodeMidgardTxOutput |
| `node_landed_blocks.tx_ids` | `cardinality` -> `transactions` |
| `node_landed_blocks.deposit_ids` | `cardinality` -> `deposits` |
| `node_landed_blocks.withdrawals` | `jsonb_array_length` -> `withdrawals` |
| `node_landed_blocks.forced_ids` | `cardinality` -> `forcedTransactions` |

**`transformed-rendered` (7).** The state queue view counts four `node_landed_blocks` arrays in SQL (`db/stateQueue.ts`) and emits only the counts. `routes/address.ts:40` passes `output` to `computeBalance` exactly as `routes/deposits.ts:19` passes `ledger_output`, and `routes/asset.ts:35` decodes it with `codec.decodeMidgardTxOutput`. No route emits raw `output` hex.

Two corrections are folded in here. An earlier revision marked `ledger_output` derived while marking the two ledger `output` columns rendered, which was inconsistent. A later one stated "no route emits raw `tx` or `output` hex", which is **false for `tx`**: the transaction detail route emits it as `cborHex`.

## Column-level verdicts: all gaps

Every row carries its `table.column` id in an HTML comment, so verification is table-qualified rather than name-based.

### `address_history` (1 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `created_at` <!-- address_history.created_at --> | timestamp with time zone | not-read | not measured | **defer** | n/a | `time_stamp_tz` already carries user-facing ordering |

### `confirmed_ledger` (2 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `time_stamp_tz` <!-- confirmed_ledger.time_stamp_tz --> | timestamp with time zone | not-read | not measured | **defer** | n/a | the transaction path carries it |
| `tx_id` <!-- confirmed_ledger.tx_id --> | bytea | not-read | not measured | **defer** | n/a | the transaction path carries it |

### `da_payloads` (9 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `block_time` <!-- da_payloads.block_time --> | timestamp with time zone | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `consensus_profile_id` <!-- da_payloads.consensus_profile_id --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `created_at` <!-- da_payloads.created_at --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |
| `payload_cbor` <!-- da_payloads.payload_cbor --> | bytea | not-read | not measured | **defer** | n/a | `block.ts:264`: payload bytes stay in the node journal, not duplicated in JSON |
| `payload_sha256` <!-- da_payloads.payload_sha256 --> | bytea | not-read | not measured | **adopt** | detail |  |
| `updated_at` <!-- da_payloads.updated_at --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |
| `validation_trace_count` <!-- da_payloads.validation_trace_count --> | bigint | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `validation_traces_root` <!-- da_payloads.validation_traces_root --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `version` <!-- da_payloads.version --> | integer | not-read | not measured | **adopt** | detail |  |

### `deposits_utxos` (3 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `event_info` <!-- deposits_utxos.event_info --> | bytea | not-read | 88 B (n=11) | **adopt** | list |  |
| `l1_event_key` <!-- deposits_utxos.l1_event_key --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `l1_origin_outref` <!-- deposits_utxos.l1_origin_outref --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |

### `forced_transaction_utxos` (11 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `asset_name` <!-- forced_transaction_utxos.asset_name --> | bytea | not-read | not measured | **adopt** | list | schema-bounded 1-32 B |
| `cek_program_material_sidecar_cbor` <!-- forced_transaction_utxos.cek_program_material_sidecar_cbor --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `cek_program_material_sidecar_sha256` <!-- forced_transaction_utxos.cek_program_material_sidecar_sha256 --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `consensus_profile_id` <!-- forced_transaction_utxos.consensus_profile_id --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `created_at` <!-- forced_transaction_utxos.created_at --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |
| `forced_inclusion_value` <!-- forced_transaction_utxos.forced_inclusion_value --> | bytea | not-read | not measured | **adopt** | opt-in-raw | no rows exist; conservative default |
| `native_tx_cbor` <!-- forced_transaction_utxos.native_tx_cbor --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `raw_datum` <!-- forced_transaction_utxos.raw_datum --> | bytea | not-read | not measured | **adopt** | opt-in-raw | no rows exist; conservative default |
| `transaction_commitment` <!-- forced_transaction_utxos.transaction_commitment --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `tx_compact` <!-- forced_transaction_utxos.tx_compact --> | bytea | not-read | not measured | **adopt** | opt-in-raw | no rows exist; conservative default |
| `updated_at` <!-- forced_transaction_utxos.updated_at --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |

### `mempool` (1 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `included_by` <!-- mempool.included_by --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |

### `mempool_ledger` (3 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `source_event_id` <!-- mempool_ledger.source_event_id --> | bytea | referenced-only | not measured | **defer** | n/a | join key only; the event pages carry the id |
| `time_stamp_tz` <!-- mempool_ledger.time_stamp_tz --> | timestamp with time zone | not-read | not measured | **defer** | n/a | the transaction path carries it |
| `tx_id` <!-- mempool_ledger.tx_id --> | bytea | not-read | not measured | **defer** | n/a | the transaction path carries it |

### `mempool_tx_deltas` (3 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `produced_cbor` <!-- mempool_tx_deltas.produced_cbor --> | bytea | not-read | not measured | **adopt** | detail |  |
| `spent_cbor` <!-- mempool_tx_deltas.spent_cbor --> | bytea | not-read | not measured | **adopt** | detail |  |
| `tx_id` <!-- mempool_tx_deltas.tx_id --> | bytea | not-read | not measured | **adopt** | detail |  |

### `node_confirmed_ledger_frontier` (2 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `id` <!-- node_confirmed_ledger_frontier.id --> | boolean | not-read | not measured | **exclude** | n/a | the single row's key, always true |
| `utxos_root` <!-- node_confirmed_ledger_frontier.utxos_root --> | text | not-read | not measured | **defer** | n/a | the confirmed header's own block page shows it |

### `node_confirmed_merges` (19 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `applied` <!-- node_confirmed_merges.applied --> | boolean | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `consumed_deposit_ids` <!-- node_confirmed_merges.consumed_deposit_ids --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `deposit_ids` <!-- node_confirmed_merges.deposit_ids --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `finalized_forced_ids` <!-- node_confirmed_merges.finalized_forced_ids --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `finalized_withdrawal_ids` <!-- node_confirmed_merges.finalized_withdrawal_ids --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `folded_at` <!-- node_confirmed_merges.folded_at --> | timestamptz | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `forced_ids` <!-- node_confirmed_merges.forced_ids --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `header_hash` <!-- node_confirmed_merges.header_hash --> | bytea | referenced-only | not measured | **defer** | n/a | marks a block merged while a rollback could still undo it |
| `kind` <!-- node_confirmed_merges.kind --> | text | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `merge_out_ref` <!-- node_confirmed_merges.merge_out_ref --> | text | not-read | not measured | **defer** | n/a | the merge's Cardano point; a candidate for the block's settlement details |
| `merge_slot` <!-- node_confirmed_merges.merge_slot --> | bigint | not-read | not measured | **defer** | n/a | the merge's Cardano point; a candidate for the block's settlement details |
| `parent_header_hash` <!-- node_confirmed_merges.parent_header_hash --> | bytea | referenced-only | not measured | **defer** | n/a | links a merged block to its parent for the ancestry walk |
| `parent_utxos_root` <!-- node_confirmed_merges.parent_utxos_root --> | text | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `produced_outputs` <!-- node_confirmed_merges.produced_outputs --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `produced_outrefs` <!-- node_confirmed_merges.produced_outrefs --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `spent` <!-- node_confirmed_merges.spent --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `tx_ids` <!-- node_confirmed_merges.tx_ids --> | bytea[] | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `utxos_root` <!-- node_confirmed_merges.utxos_root --> | text | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |
| `withdrawals` <!-- node_confirmed_merges.withdrawals --> | jsonb | not-read | not measured | **defer** | n/a | the node's record for undoing the merge |

### `node_landed_blocks` (7 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `applied` <!-- node_landed_blocks.applied --> | boolean | not-read | not measured | **defer** | n/a | the node's own ledger bookkeeping |
| `parent_utxos_root` <!-- node_landed_blocks.parent_utxos_root --> | text | not-read | not measured | **defer** | n/a | the block page shows the header's roots |
| `produced_outputs` <!-- node_landed_blocks.produced_outputs --> | bytea[] | not-read | not measured | **defer** | n/a | the block page lists the transactions |
| `produced_outrefs` <!-- node_landed_blocks.produced_outrefs --> | bytea[] | not-read | not measured | **defer** | n/a | the block page lists the transactions |
| `spent` <!-- node_landed_blocks.spent --> | bytea[] | not-read | not measured | **defer** | n/a | the block page lists the transactions |
| `state` <!-- node_landed_blocks.state --> | text | referenced-only | not measured | **defer** | n/a | filters queued from removed; removed headers are counted |
| `utxos_root` <!-- node_landed_blocks.utxos_root --> | text | not-read | not measured | **defer** | n/a | the block page shows the header's roots |

### `pending_block_finalization_deposits` (7 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `header_hash` <!-- pending_block_finalization_deposits.header_hash --> | bytea | referenced-only | not measured | **defer** | n/a | join key; the block is the page context |
| `l1_event_key` <!-- pending_block_finalization_deposits.l1_event_key --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `l1_origin_outref` <!-- pending_block_finalization_deposits.l1_origin_outref --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `payload_cbor` <!-- pending_block_finalization_deposits.payload_cbor --> | bytea | not-read | not measured | **defer** | n/a | `block.ts:264`, deliberate |
| `payload_sha256` <!-- pending_block_finalization_deposits.payload_sha256 --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_id` <!-- pending_block_finalization_deposits.source_id --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_table` <!-- pending_block_finalization_deposits.source_table --> | text | not-read | not measured | **adopt** | detail |  |

### `pending_block_finalization_event_to_step` (8 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `header_hash` <!-- pending_block_finalization_event_to_step.header_hash --> | bytea | not-read | not measured | **adopt** | detail |  |
| `member_id` <!-- pending_block_finalization_event_to_step.member_id --> | bytea | not-read | not measured | **adopt** | detail |  |
| `ordinal` <!-- pending_block_finalization_event_to_step.ordinal --> | integer | not-read | not measured | **adopt** | detail |  |
| `payload_cbor` <!-- pending_block_finalization_event_to_step.payload_cbor --> | bytea | not-read | not measured | **defer** | n/a | same reason; revisit with the verification decision |
| `payload_sha256` <!-- pending_block_finalization_event_to_step.payload_sha256 --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_id` <!-- pending_block_finalization_event_to_step.source_id --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_table` <!-- pending_block_finalization_event_to_step.source_table --> | text | not-read | not measured | **adopt** | detail |  |
| `source_time_stamp_tz` <!-- pending_block_finalization_event_to_step.source_time_stamp_tz --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |

### `pending_block_finalization_forced_transactions` (5 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `header_hash` <!-- pending_block_finalization_forced_transactions.header_hash --> | bytea | referenced-only | not measured | **defer** | n/a | join key; the block is the page context |
| `payload_cbor` <!-- pending_block_finalization_forced_transactions.payload_cbor --> | bytea | not-read | not measured | **defer** | n/a | `block.ts:264`, deliberate |
| `payload_sha256` <!-- pending_block_finalization_forced_transactions.payload_sha256 --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_id` <!-- pending_block_finalization_forced_transactions.source_id --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_table` <!-- pending_block_finalization_forced_transactions.source_table --> | text | not-read | not measured | **adopt** | detail |  |

### `pending_block_finalization_transition_trace` (8 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `header_hash` <!-- pending_block_finalization_transition_trace.header_hash --> | bytea | not-read | not measured | **adopt** | detail |  |
| `member_id` <!-- pending_block_finalization_transition_trace.member_id --> | bytea | not-read | not measured | **adopt** | detail |  |
| `ordinal` <!-- pending_block_finalization_transition_trace.ordinal --> | integer | not-read | not measured | **adopt** | detail |  |
| `payload_cbor` <!-- pending_block_finalization_transition_trace.payload_cbor --> | bytea | not-read | not measured | **defer** | n/a | same reason; revisit with the verification decision |
| `payload_sha256` <!-- pending_block_finalization_transition_trace.payload_sha256 --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_id` <!-- pending_block_finalization_transition_trace.source_id --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_table` <!-- pending_block_finalization_transition_trace.source_table --> | text | not-read | not measured | **adopt** | detail |  |
| `source_time_stamp_tz` <!-- pending_block_finalization_transition_trace.source_time_stamp_tz --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |

### `pending_block_finalization_txs` (5 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `cek_program_material_sidecar_cbor` <!-- pending_block_finalization_txs.cek_program_material_sidecar_cbor --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `cek_program_material_sidecar_sha256` <!-- pending_block_finalization_txs.cek_program_material_sidecar_sha256 --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `payload_sha256` <!-- pending_block_finalization_txs.payload_sha256 --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_id` <!-- pending_block_finalization_txs.source_id --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_table` <!-- pending_block_finalization_txs.source_table --> | text | not-read | not measured | **adopt** | detail |  |

### `pending_block_finalization_withdrawals` (11 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `classification_revision` <!-- pending_block_finalization_withdrawals.classification_revision --> | integer | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `classification_sha256` <!-- pending_block_finalization_withdrawals.classification_sha256 --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `header_hash` <!-- pending_block_finalization_withdrawals.header_hash --> | bytea | referenced-only | not measured | **defer** | n/a | join key; the block is the page context |
| `l1_event_key` <!-- pending_block_finalization_withdrawals.l1_event_key --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `l1_origin_outref` <!-- pending_block_finalization_withdrawals.l1_origin_outref --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `payload_cbor` <!-- pending_block_finalization_withdrawals.payload_cbor --> | bytea | not-read | not measured | **defer** | n/a | `block.ts:264`, deliberate |
| `payload_sha256` <!-- pending_block_finalization_withdrawals.payload_sha256 --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_id` <!-- pending_block_finalization_withdrawals.source_id --> | bytea | not-read | not measured | **adopt** | detail |  |
| `source_table` <!-- pending_block_finalization_withdrawals.source_table --> | text | not-read | not measured | **adopt** | detail |  |
| `validity_detail` <!-- pending_block_finalization_withdrawals.validity_detail --> | jsonb | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `validity` <!-- pending_block_finalization_withdrawals.validity --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |

### `pending_block_finalizations` (32 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `base_snapshot_id` <!-- pending_block_finalizations.base_snapshot_id --> | text | not-read | not measured | **adopt** | detail |  |
| `base_tail_datum_cbor` <!-- pending_block_finalizations.base_tail_datum_cbor --> | text | not-read | 754 B (n=9) | **adopt** | opt-in-raw | largest field found; never in a list |
| `base_tail_header_hash` <!-- pending_block_finalizations.base_tail_header_hash --> | bytea | referenced-only | not measured | **adopt** | detail |  |
| `base_tail_out_ref` <!-- pending_block_finalizations.base_tail_out_ref --> | text | not-read | not measured | **adopt** | detail |  |
| `commit_anchor_hash` <!-- pending_block_finalizations.commit_anchor_hash --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `commit_anchor_height` <!-- pending_block_finalizations.commit_anchor_height --> | bigint | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `commit_anchor_slot` <!-- pending_block_finalizations.commit_anchor_slot --> | bigint | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `consensus_profile_id` <!-- pending_block_finalizations.consensus_profile_id --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `correction_transition_digest` <!-- pending_block_finalizations.correction_transition_digest --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `deployment_manifest_id` <!-- pending_block_finalizations.deployment_manifest_id --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `deployment_marker_schema_version` <!-- pending_block_finalizations.deployment_marker_schema_version --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `expected_total_event_count` <!-- pending_block_finalizations.expected_total_event_count --> | bigint | not-read | not measured | **adopt** | detail |  |
| `expected_transition_step_count` <!-- pending_block_finalizations.expected_transition_step_count --> | bigint | not-read | not measured | **adopt** | detail |  |
| `expected_validation_trace_count` <!-- pending_block_finalizations.expected_validation_trace_count --> | bigint | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `expected_validation_traces_root` <!-- pending_block_finalizations.expected_validation_traces_root --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `format_version` <!-- pending_block_finalizations.format_version --> | smallint | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `header_cbor` <!-- pending_block_finalizations.header_cbor --> | bytea | not-read | 361 B (n=9) | **adopt** | provisional | delivery decided at the `target` profile; never in a list |
| `intended_tx_hash` <!-- pending_block_finalizations.intended_tx_hash --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `ledger_delta_produced` <!-- pending_block_finalizations.ledger_delta_produced --> | jsonb | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `ledger_delta_spent` <!-- pending_block_finalizations.ledger_delta_spent --> | jsonb | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `mpf_owner_binary_sha256` <!-- pending_block_finalizations.mpf_owner_binary_sha256 --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `mpf_owner_schema` <!-- pending_block_finalizations.mpf_owner_schema --> | smallint | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `mpf_replay_base_root` <!-- pending_block_finalizations.mpf_replay_base_root --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `mpf_replay_candidate_root` <!-- pending_block_finalizations.mpf_replay_candidate_root --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `mpf_replay_event_count` <!-- pending_block_finalizations.mpf_replay_event_count --> | integer | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `mpf_replay_event_log_digest` <!-- pending_block_finalizations.mpf_replay_event_log_digest --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `mpf_replay_event_log` <!-- pending_block_finalizations.mpf_replay_event_log --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `mpf_replay_event_roots` <!-- pending_block_finalizations.mpf_replay_event_roots --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `prepared_tx_hash` <!-- pending_block_finalizations.prepared_tx_hash --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `replay_kind` <!-- pending_block_finalizations.replay_kind --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `signed_tx_cbor` <!-- pending_block_finalizations.signed_tx_cbor --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `state_queue_lease_token` <!-- pending_block_finalizations.state_queue_lease_token --> | text | not-read | not measured | **exclude** | n/a | D6 operator lease |

### `processed_mempool` (1 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `included_by` <!-- processed_mempool.included_by --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |

### `tx_admissions` (6 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `arrival_seq` <!-- tx_admissions.arrival_seq --> | bigint | not-read | not measured | **adopt** | detail |  |
| `last_seen_at` <!-- tx_admissions.last_seen_at --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |
| `lease_expires_at` <!-- tx_admissions.lease_expires_at --> | timestamp with time zone | not-read | not measured | **exclude** | n/a | D6 |
| `lease_owner` <!-- tx_admissions.lease_owner --> | text | not-read | not measured | **exclude** | n/a | D6 |
| `next_attempt_at` <!-- tx_admissions.next_attempt_at --> | timestamp with time zone | not-read | not measured | **exclude** | n/a | D6 |
| `tx_id` <!-- tx_admissions.tx_id --> | bytea | referenced-only | not measured | **defer** | n/a | join key; the id is already the page key |

### `tx_rejections` (1 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `tx_id` <!-- tx_rejections.tx_id --> | bytea | referenced-only | not measured | **defer** | n/a | join key; the id is already the page key |

### `withdrawal_utxos` (16 unexposed)

| Column | Type | SQL | Size | Decision | Delivery | Reason |
|---|---|---|---|---|---|---|
| `asset_name` <!-- withdrawal_utxos.asset_name --> | bytea | not-read | 32 B (n=1) | **adopt** | list | schema-bounded 1-32 B |
| `classification_revision` <!-- withdrawal_utxos.classification_revision --> | integer | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `created_at` <!-- withdrawal_utxos.created_at --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |
| `l1_datum` <!-- withdrawal_utxos.l1_datum --> | bytea | not-read | not measured | **adopt** | opt-in-raw |  |
| `l1_event_key` <!-- withdrawal_utxos.l1_event_key --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `l1_origin_outref` <!-- withdrawal_utxos.l1_origin_outref --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `l2_ledger_outref_state` <!-- withdrawal_utxos.l2_ledger_outref_state --> | text | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `l2_ledger_outref` <!-- withdrawal_utxos.l2_ledger_outref --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `l2_owner` <!-- withdrawal_utxos.l2_owner --> | bytea | not-read | 28 B (n=1) | **adopt** | list |  |
| `raw_event_info` <!-- withdrawal_utxos.raw_event_info --> | bytea | not-read | 274 B (n=1) | **adopt** | opt-in-raw |  |
| `refund_address` <!-- withdrawal_utxos.refund_address --> | bytea | not-read | 80 B (n=1) | **adopt** | list |  |
| `refund_datum` <!-- withdrawal_utxos.refund_datum --> | bytea | not-read | not measured | **adopt** | opt-in-raw |  |
| `reopened_from_header_hash` <!-- withdrawal_utxos.reopened_from_header_hash --> | bytea | not-read | not measured | **defer** | n/a | added by Midgard migrations through 0027 (`f4cf28ca1`); not yet assessed |
| `settlement_event_info` <!-- withdrawal_utxos.settlement_event_info --> | bytea | not-read | null on n=1 | **adopt** | opt-in-raw | null on the only row; seed a settled withdrawal |
| `updated_at` <!-- withdrawal_utxos.updated_at --> | timestamp with time zone | not-read | not measured | **adopt** | detail |  |
| `validity_detail` <!-- withdrawal_utxos.validity_detail --> | jsonb | not-read | 4 B (n=1) | **adopt** | list | why a withdrawal is invalid; the UI shows only the boolean `validity` |

## Known limits of this audit

1. **Layer evidence is presence-based, not path-traced.** "Reaches the contract" means a contract field of that name (or its recorded alias) exists, not that a proof connects this column to that field. A column and an unrelated field sharing a name would pass. The eleven renames were resolved by reading the code and the twelve Merkle roots were traced when they were added; the other 91 were not individually traced.
2. **Sizes come from 0 to 108 rows.** Maxima, not distributions. Every `provisional` delivery verdict must be re-measured at the `target` profile.
3. **The detector is a scratch script.** Per the lint decision it does **not** go into CI as-is. The durable version lands during `SCHEMA-FIXTURE`, after the four missing tables are added, as a separate commit: keyed by `table.column`, reading the checked-in schema fixture as its deterministic source, emitting the manifest, and validating this Markdown rather than parsing prose as truth.

## Verification

```bash
python3 /tmp/claude-1000/check.py    # section-aware, table-qualified
# gaps checked: 98    FAIL: 0
```

The earlier name-only check (`'`'+column+'`' in doc`) could not tell one table's `payload_sha256` from another's. One mention satisfied six tables. The current check requires each gap to appear inside its own table's section, and the generated tables carry the `table.column` id in an HTML comment.

## Consequences for other plan items

- **`SCHEMA-FIXTURE`:** the fixture already carries every adopted column. Only the four never-queried tables are missing.
- **`DATASETS`:** must populate all 77 columns adopted on 2026-09-04 (77 adopt, 17 defer, 4 exclude across 98 gaps, before the twelve Merkle roots were exposed), and must synthesize rows for `forced_transaction_utxos` (0 rows) and `mempool_tx_deltas` (0 rows), plus a settled withdrawal so `settlement_event_info` is non-null. Use known-valid protocol fixtures. **Synthetic sizes establish functional coverage and protocol bounds, never a production p99**, and the register must say so beside any budget derived from them.
- **`CHEAP-COVERAGE`:** the twelve Merkle roots are exposed on the block page's Merkle roots tab. The rest of the `pending_block_finalizations` group plus the small bounded `withdrawal_utxos` and `forced_transaction_utxos` fields ride existing queries.
- **`REMAINING-COVERAGE`:** the four new tables, the provenance triple, and every field whose delivery is provisional.

## Delivery rule

A column enters a 25-row list response only when its size is bounded by schema or by a measured distribution. Otherwise it goes to detail or opt-in. The decision uses **whole-response wire impact**, not a raw-field threshold: a `bytea` exposed as hex roughly doubles before JSON overhead, so `header_cbor` at 361 bytes contributes about 722 characters plus framing.

## Resolved decisions

1. **`header_cbor`:** defer delivery to the `target` benchmark. Inline in block detail if the whole response stays inside both uncompressed and compressed payload budgets. **Never in a block list.** A separate raw route is justified only if the default-response or cache budget fails.
2. **Forced-transaction fields:** seed from known-valid protocol fixtures for functional coverage. `asset_name` to the list (schema-bounded); `raw_datum`, `tx_compact`, `forced_inclusion_value` to detail or opt-in until real distributions exist.
3. **`settlement_event_info`:** adopt now, seed a settled withdrawal, default to detail or opt-in until a real distribution or protocol bound exists.
