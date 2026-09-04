# Dataset profile specification

Proposed 2026-09-04. Empty-block rate, `target` size and assumption ownership approved 2026-09-04. Corrected 2026-09-04 after review found the profile was not executable against the real node schema.

Governs `backend/bench/profiles.mts` and `backend/bench/seed-shaped.mts`. Consumed by `docs/performance-budgets.md`, whose provenance column says which workloads use which source.

## Sources, and which is real

| Source | Real volume, measured 2026-09-04 | Use |
|---|---|---|
| **Explorer index** | `l1_tx` 281, `l1_tx_io` 2,767, `l1_tx_asset` 1,714, `l1_redeemer` 312, `l1_event` 297, `l1_block_header` 9. 13 MB, 2026-07-01 to 2026-09-02 | **Real. Clone it. Never synthesize L1** |
| **Node database** | 9 finalized blocks, 2 journaled transactions, 9 `da_payloads` | Real, and too small for any volume budget |

The node averages **309,843 seconds (3.6 days) between blocks** and has produced nothing in 22 days. Five thousand real blocks is roughly fifty years. Page 100 of the blocks list needs 2,500 rows to exist.

**Benchmark databases are isolated and frozen.** The live explorer index is cloned into a checksummed benchmark snapshot by `backend/bench/cloneIndex.mts`; benchmarks never read from or write to the live index. Two reasons, both load-bearing: a moving source makes two runs incomparable, and a write would corrupt the only real data the explorer holds. The snapshot's checksum is recorded with every baseline, so a number can be traced to the exact data that produced it.

Verified 2026-09-04 against the live index: **5,392 rows** copied (`l1_tx` 281, `l1_tx_io` 2,767, `l1_tx_asset` 1,714, `l1_redeemer` 312, `l1_event` 297, `l1_block_header` 9, `l1_protocol_params` 9, `sync_cursor` 3), and **9 real 28-byte L2 header hashes** read from `l1_block_header.header_hash`, which carries the value minted into the MBLC state-queue token. Those hashes are what `generateDataset` assigns to its settled blocks, so I6 is an agreement with real data rather than a shape check.

## Schema constraints the profile must satisfy

Not style guidance. These come from `backend/test/fixtures/schema/midgard-node.sql` and a profile violating any of them cannot be inserted at all.

| Constraint | Source | Consequence for the profile |
|---|---|---|
| `status` is one of `pending_submission`, `submitted_local_finalization_pending`, `submitted_unconfirmed`, `observed_waiting_stability`, `finalized`, `abandoned` | `pending_block_finalizations_status_check` | **There is no `failed`.** The terminal failure status is `abandoned` |
| **At most one row may be non-terminal, in the entire table** | `uniq_pending_block_finalizations_single_active`: a UNIQUE index on the constant `(1)` with a partial predicate over the four non-terminal states | A fractional "6% pending" is uninsertable, not merely imprecise. The profile states `activeRows: 0 or 1` and names the single state |
| `expected_total_event_count = expected_withdrawal_count + expected_forced_transaction_count + expected_l2_transaction_count + expected_deposit_count` | `..._expected_count_sum_check` | The per-block event counts are not independent knobs |
| `expected_transition_step_count = expected_total_event_count` | `..._expected_trace_count_check` | Derived, never generated separately |
| Every `*_root` matches `^[0-9a-f]{64}$` | `..._expected_transition_trace_roo_check`, `..._expected_event_to_step_root_check` | Confirms I2 at the database level |
| `octet_length(base_tail_header_hash) = 28` | `..._base_tail_header_hash_check` | Confirms I1 at the database level |
| `octet_length(header_cbor) > 0` | `..._header_cbor_check` | No empty CBOR, even for an empty block |
| 28 `NOT NULL` columns without defaults | table definition | I11 |

## Invariants every profile must satisfy

These are correctness properties, not size knobs. A generator that violates one produces a benchmark that measures the wrong thing.

| # | Invariant | Why |
|---|---|---|
| I1 | `header_hash` is **28 bytes**, 56 hex characters | `utils.ts:15` `HASH28_HEX = 56`; a 32-byte hash fails `isHash28` before any query runs. Enforced by the DDL for `base_tail_header_hash` |
| I2 | Merkle roots are **64-character text**, already hex | D12. They are 32-byte values in a `text` column; never `toHex`, never `isHash28`. Enforced by the DDL's regex checks |
| I3 | Every block has a **distinct** `block_end_time` except where I4 requires otherwise | Ordering must be total or pagination is nondeterministic |
| I4 | **The ordering profiles (`target`, `stress`) put ~5% of blocks on a shared `block_end_time`.** `small` has none | This is what makes the `header_hash` tiebreak observable, so `BYTEA-ORDERING`'s correctness test runs on `target` or `stress`. `small` mirrors live data, which has no collisions, so requiring them there would contradict its purpose |
| I5 | **The node's count arithmetic holds exactly.** `expected_l2_transaction_count` equals the journal row count; the four event counts sum to `expected_total_event_count`; `expected_transition_step_count` equals it | The live node satisfies the first on all 9 rows, and the database enforces the rest. A generator that breaks any of them makes the block page contradict itself |
| I6 | **Cross-source identifiers agree on the overlap set, and the rest are explicitly unsettled** | The index snapshot holds 9 real `l1_block_header` rows, so at most 9 generated blocks can carry a real settlement counterpart. Requiring all 5,000 to agree is impossible. Requiring the 9 is possible, and it exercises both render paths: `getDeploymentContext`, `getIndexSettlement` and `blockSettlement` on the settled blocks, and the not-yet-settled path on the rest. **An unsettled block must render as unsettled, never as missing data** |
| I7 | Every field marked `adopt` or already-exposed in `coverage-manifest.json` receives a **semantically valid** value | ADR 0008. The generator fails rather than emitting a column-name digest |
| I8 | Transaction bytes are **codec-produced and codec-readable** | Preserves the existing property that a seed cannot describe a transaction the decoder would reject. Necessary, and weaker than I14 |
| I14 | **Transactions are spendable, not merely decodable.** Every outref is produced once and spent at most once; every input names an output produced earlier; lovelace balances exactly as inputs = outputs + fee; assets are conserved because nothing mints | `outref` is the primary key of `mempool_ledger` and `confirmed_ledger`, so a duplicate is a failed load, not a realism complaint. An earlier generator cycled two input templates, which duplicated inputs inside a transaction and re-spent the same outref in every transaction of the dataset. Value and asset conservation are what stop the address and asset pages from displaying balances that could not exist |
| I9 | Foreign keys resolve; no orphan members | Cascade relationships are real in the schema |
| I10 | Generation is **deterministic**: same profile, same bytes | A baseline that cannot be reproduced is not a baseline |
| I11 | **Excluded from coverage does not mean excluded from seeding.** Every `NOT NULL` column without a default must be filled, whatever its coverage verdict | Found 2026-09-04: `pending_block_finalizations` has **28** such columns, including `state_queue_lease_token`, which `coverage-scope.md` marks `exclude` under D6. A generator that seeds only adopted columns cannot insert a single row |
| I12 | **A profile that claims to cross a bound crosses it strictly** | Two bounds, both `>` and not `>=`. `getSpendableLedger` reports `truncated: total > rows.length` against `SCAN_LIMIT = 20_000`, and `decode/transaction.ts:512` sets `cborTruncated` on `txBytes.length > MAX_INLINE_CBOR_BYTES`. Sized exactly on either bound, the truncation path is never taken and the budget measures the easy case while appearing to measure the hard one |
| I13 | **Transaction bytes are derived from structure, never dialled to a number** | Inputs, outputs and assets per output determine the size. Specifying the byte distribution independently over-constrains the generator and lets it satisfy one while violating the other. The two agree where it matters: the codec encodes a 1-input, 2-output transaction at 386 B against a measured live p50 of 383 B |

## Profiles

Three, chosen to answer three different questions.

### `small`

**Question: does the read path work?** Replaces the current 6-transaction seed for correctness tests. This profile mirrors observed reality rather than challenging it: `target` is where the pessimistic bias lives.

| Property | Value |
|---|---|
| Blocks | 50 |
| Transactions per block | 0 to 5, mean 1.2 |
| Empty blocks | **78%**, matching the live node exactly (7 of 9) |
| Status mix | 100% `finalized`, **0 active** (the live node has no active finalization) |
| Timestamp collisions | none (I4) |
| Ledger UTxOs | 200, below `SCAN_LIMIT`, so no truncation |
| Deposits / withdrawals / forced | 29 / 15 / 14, **derived** from the per-block shapes |
| Settled against real L1 | 9 blocks |

### `target`

**Question: does it meet its budget at a plausible production size?** The profile every approved budget is measured against.

| Property | Value | Basis |
|---|---|---|
| Blocks | 5,000 | **APPROVED as benchmark headroom, not as a production forecast.** Derived from page 100 at 25 rows per page needing 2,500 rows to exist |
| Transactions per block | long tail, p50 1, p95 20, p99 60, max 200 | **ASSUMPTION** |
| Empty blocks | **30%** | **APPROVED as a pessimistic challenge profile.** Live data is 78% empty; 30% is deliberately harsher because 78% would make most list pages trivially cheap and hide the cost the budgets exist to catch |
| Status mix | terminal rows 98% `finalized` / 2% `abandoned`, plus **exactly one** `submitted_unconfirmed` | Terminal split is an **ASSUMPTION**; the single active row is schema-enforced |
| Timestamp collisions | 5% of blocks share `block_end_time` | I4 |
| Ledger UTxOs | **25,000** | Above `SCAN_LIMIT` (20,000) so `truncated` is true and `asset-roster` measures the partial-coverage path (I12) |
| Deposits / withdrawals / forced | **3,700 / 1,850 / 250**, derived | Totals are computed from the per-block shapes, never declared beside them. An earlier draft stated 2,000 / 800 / 300 next to shapes implying 3,700 / 1,850 / 250, and no generator can satisfy both |
| Settled against real L1 | 9 blocks; the other 4,991 render as unsettled (I6) |
| Transaction body size | p50 383 B, p95 2 KB, p99 6 KB | **Derived, not dialled.** An outcome of the structure shapes below; p50 from the live `immutable` measurement, and the codec independently encodes a 1-input, 2-output transaction at 386 B |
| Oversize transactions | 5, each above 64 KB | The structure shapes top out near 6 KB, so nothing else crosses `MAX_INLINE_CBOR_BYTES` (I12) |
| `header_cbor` | p50 361 B, p95 1 KB | p50 measured live; tail assumed |

### `stress`

**Question: does it degrade gracefully rather than fall over?** Not a pass/fail profile; a shape check.

| Property | Value |
|---|---|
| Blocks | 50,000 |
| Transactions per block | same shape, max 500 |
| Ledger UTxOs | 200,000 |
| Status mix | same terminal split, one `observed_waiting_stability` |
| Everything else | scaled proportionally |

## Distributions the generator needs

Stated because without them two implementations satisfy the same profile and produce materially different workloads, and both report a pass. Percentiles are per the unit named.

| Field | Unit | `small` | `target` / `stress` |
|---|---|---|---|
| `inputsPerTx` | inputs | p50 1, p95 3, p99 4, max 5 | p50 1, p95 4, p99 12, max 40 |
| `outputsPerTx` | outputs | p50 2, p95 4, p99 5, max 6 | p50 2, p95 6, p99 16, max 60 |
| `assetsPerOutput` | native assets beyond ada | p50 0, p95 1, p99 2, max 3 | p50 0, p95 2, p99 5, max 20 |
| `depositsPerBlock` | rows | p50 0, p95 2, p99 3, max 4 | p50 0, p95 2, p99 6, max 20 |
| `withdrawalsPerBlock` | rows | p50 0, p95 1, p99 2, max 2 | p50 0, p95 1, p99 3, max 10 |
| `forcedPerBlock` | rows | p50 0, p95 1, p99 1, max 1 | p50 0, p95 0, p99 1, max 5 |
| `addresses` | distinct | 40 | 5,000 / 50,000 |
| `assets` | distinct policy plus name | 8 | 400 / 4,000 |
| `addressSkew` | Zipf exponent | 1.1 | 1.2 |
| `assetHolderSkew` | Zipf exponent | 1.1 | 1.2 |
| `assetQuantity` | quantity per position | p50 1, p95 1e3, p99 1e5, max 1e7 | p50 1, p95 1e4, p99 1e6, max 9e9 |
| `datumRate` | share of outputs | 0.10 | 0.15 |
| `scriptRefRate` | share of outputs | 0.05 | 0.05 |
| `redeemerRate` | share of transactions | 0.10 | 0.20 |
| `admissionMix` | share of `tx_admissions` | 10 / 5 / 80 / 5 | 5 / 2 / 85 / 8 (queued / validating / accepted / rejected) |
| `eventPayloadBytes` | bytes | p50 88, p95 274, p99 512, max 1,024 | p50 88, p95 274, p99 1,024, max 4,096 |

**Skew is not decoration.** Uniform addresses give every address about one entry at `target`, so `address-history` measures a one-row page and reports a pass. The same holds for asset holders and the asset roster. `eventPayloadBytes` p50 and p95 are the live measured `event_info` (88 B) and `raw_event_info` (274 B) sizes.

**`admissionMix` is a set of constraints, not a ratio.** `tx_admissions_check1` requires a lease owner and expiry on `validating` and forbids them elsewhere; `tx_admissions_check2` requires `terminal_at` on `accepted` and `rejected` and forbids it on `queued` and `validating`. Every state must appear or those paths are never seeded.
| `searchMix` | share of issued terms | 50% unique hit, 25% multi hit, 25% miss | same |

Totals are **derived from these shapes**, never stated beside them (I13 extended). Per-block event counts are also constrained, not free: the four kinds must sum to `expected_total_event_count`, which must equal `expected_transition_step_count` (I5). The generator draws the four, then writes the sums; it never draws the sums.

`searchMix` matters more than it looks. An all-miss mix measures the index scan and never the result assembly; an all-hit mix does the reverse. Both would report a `search-prefix` pass while measuring half the route.

## What is assumption, and who owns it

**The live database holds 9 blocks and 2 transactions. That cannot yield a distribution.** Every row below is a stated engineering assumption, not an observation.

**Ownership, ruled 2026-09-04: explorer engineering owns the challenge-profile assumptions**, with **mandatory recalibration** once sufficient real persisted data exists (ADR 0008 makes that data accumulate). Recalibration is not optional and not indefinitely deferred: when a table's persisted volume can produce a distribution, the assumption is replaced and every baseline derived from it is re-measured.

| Assumption | Current basis | Status |
|---|---|---|
| Transactions per block distribution | None. Live data has 2 transactions across 9 blocks | Explorer engineering; recalibrate |
| Terminal status split 98/2 | None. Live data is 100% `finalized`, 0 `abandoned` | Explorer engineering; recalibrate |
| Inputs, outputs, assets per output | None. No live transaction graph exists to measure | Explorer engineering; recalibrate |
| Address and asset cardinality | Chosen for index selectivity | Explorer engineering; recalibrate |
| Per-block deposit, withdrawal and forced counts | None | Explorer engineering; recalibrate |
| Transaction body tail | p50 measured (383 B); p95/p99/max estimated | Explorer engineering; recalibrate |
| Empty-block rate 30% | Deliberate: harsher than the observed 78% | **APPROVED as a challenge profile.** Not for recalibration; it is a test-design choice |
| 5% timestamp collision rate | Chosen to make the tiebreak testable, not observed | Deliberate test-design choice, not a production claim |
| `searchMix` 50/25/25 | Chosen so every branch of the search path is exercised | Deliberate test-design choice |

Consequence, carried into the register per D16: a budget measured on `target` is **valid for comparing before and after a change** and **provisional for absolute pass/fail**.

## Generation mechanics

- `COPY FROM STDIN`, or batches sized so `rows × columns < 60,000`. The bind-parameter cap is 65,535 and `stress` writes millions of rows.
- Insert in foreign-key order: `pending_block_finalizations`, then **the event tables** (`deposits_utxos`, `withdrawal_utxos`, `forced_transaction_utxos`), then the member tables, then `da_payloads`, the ledgers and the transaction tables. **The members reference the events, not the reverse**: `pending_block_finalization_deposits.member_id` references `deposits_utxos.event_id`, and withdrawals do the same. An earlier draft of this line had it backwards and the load failed on the first deposit.
- **Take the 9 real L2 header hashes from the cloned index snapshot** and assign them to the 9 settled blocks, so I6 holds against real data rather than a re-derivation.
- `ANALYZE` after load. Without it the planner works from empty-table statistics and every plan captured is fiction.
- Record with each dataset: PostgreSQL version, `work_mem`, `shared_buffers`, `effective_cache_size`, CPU count, RAM, and the index snapshot checksum.
### What "valid" does and does not mean here

Stated rather than implied. The generated transactions satisfy I8 and I14: they decode, they spend real prior outputs exactly once, and value and assets balance.

They are **not signature-valid**. The witness set is the corpus one, so signatures do not correspond to the bodies built here, and the addresses are not the hashes of any key that signed. Making them correspond needs blake2b224 for the payment credential, which Node's `crypto` does not provide (it offers blake2b512 with no digest-length parameter), plus key generation and address derivation.

This is a deliberate boundary, not an oversight. Nothing in the explorer reads a witness or checks a credential, so signature validity buys no measurement, while the properties in I14 are the difference between a dataset that loads and one that does not. Any future consumer that needs signature validity must treat this as unmet.

- Transaction bytes come from the **real codec**: `encodeMidgardNativeTxCanonical` over structures assembled from the decoded `shape-corpus.json` parts, verified by decoding what was encoded (I8). The canonical round-trip is byte-identical, so a generated transaction is one the decoder accepts by construction.
- The `stress` seed belongs to a benchmark suite, never the unit suite.
- Seed every `NOT NULL`-without-default column (I11). For a column the coverage scope excludes, a deterministic placeholder is correct: it is never read, and its only job is to satisfy the constraint. For a column the scope adopts, a placeholder is forbidden (I7).

## Fixture pipeline

Per ADR 0008, the artifacts are a chain, not three independent generators:

```
canonical records  ->  SQL seed  ->  real backend routes  ->  contract-validated snapshots  ->  demo server
```

Nothing hand-writes a response body, and every captured response is validated against `frontend-new/contracts/src/` before it is written. A fixture therefore cannot describe a response the real route would never produce.

## Open questions

All resolved.

1. ~~Who owns the assumptions?~~ **RESOLVED 2026-09-04.** Explorer engineering, with mandatory recalibration when real persisted data can supply a distribution.
2. ~~Is 5,000 blocks the right `target`?~~ **RESOLVED 2026-09-04.** Approved as benchmark headroom, explicitly not as a production forecast. No document may cite it as a deployment size estimate.
3. ~~Empty-block rate~~ **RESOLVED 2026-09-04.** 30% approved as a pessimistic challenge profile, a deliberate test-design choice, so no downstream document may cite it as an observation.
