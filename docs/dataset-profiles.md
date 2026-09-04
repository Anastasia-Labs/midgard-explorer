# Dataset profile specification

Proposed 2026-09-04. Empty-block rate approved 2026-09-04 as a deliberate pessimistic challenge profile. **Specification only until the remaining open questions are settled.**

Governs `backend/bench/profiles.mts` and `backend/bench/seed-shaped.mts`. Consumed by `docs/performance-budgets.md`, whose provenance column says which workloads use which source.

## Sources, and which is real

| Source | Real volume, measured 2026-09-04 | Use |
|---|---|---|
| **Explorer index** | `l1_tx` 281, `l1_tx_io` 2,767, `l1_tx_asset` 1,714, `l1_redeemer` 312, `l1_event` 297, `l1_block_header` 9. 13 MB, 2026-07-01 to 2026-09-02 | **Real. Clone it. Never synthesize L1** |
| **Node database** | 9 finalized blocks, 2 journaled transactions, 9 `da_payloads` | Real, and too small for any volume budget |

The node averages **309,843 seconds (3.6 days) between blocks** and has produced nothing in 22 days. Five thousand real blocks is roughly fifty years. Page 100 of the blocks list needs 2,500 rows to exist.

**Benchmark databases are isolated and frozen.** The live explorer index is cloned into a checksummed benchmark snapshot; benchmarks never read from or write to the live index. The snapshot's checksum is recorded with every baseline, so a number can be traced to the exact data that produced it.

## Invariants every profile must satisfy

These are correctness properties, not size knobs. A generator that violates one produces a benchmark that measures the wrong thing.

| # | Invariant | Why |
|---|---|---|
| I1 | `header_hash` is **28 bytes**, 56 hex characters | `utils.ts:15` `HASH28_HEX = 56`; a 32-byte hash fails `isHash28` before any query runs |
| I2 | Merkle roots are **64-character text**, already hex | D12. They are 32-byte values in a `text` column; never `toHex`, never `isHash28` |
| I3 | Every block has a **distinct** `block_end_time` except where I4 requires otherwise | Ordering must be total or pagination is nondeterministic |
| I4 | **~5% of blocks share a `block_end_time`** with at least one other | This is what makes the `header_hash` tiebreak observable. `BYTEA-ORDERING`'s correctness test depends on it |
| I5 | `expected_l2_transaction_count` **equals** the journal row count for that block | The live node satisfies this on all 9 rows. A generator that breaks it makes the block page contradict itself |
| I6 | Cross-source identifiers **agree** between the node fixture and the index snapshot | Otherwise `getDeploymentContext`, `getIndexSettlement` and `blockSettlement` degrade, and block-detail measures missing-data handling rather than performance |
| I7 | Every field marked `adopt` or already-exposed in `coverage-manifest.json` receives a **semantically valid** value | ADR 0008. The generator fails rather than emitting a column-name digest |
| I8 | Transaction bytes are **codec-produced and codec-readable** | Preserves the existing property that a seed cannot describe a transaction the decoder would reject |
| I9 | Foreign keys resolve; no orphan members | Cascade relationships are real in the schema |
| I10 | Generation is **deterministic**: same profile, same bytes | A baseline that cannot be reproduced is not a baseline |

## Profiles

Three, chosen to answer three different questions.

### `small`

**Question: does the read path work?** Replaces the current 6-transaction seed for correctness tests. This profile mirrors observed reality rather than challenging it: `target` is where the pessimistic bias lives.

| Property | Value |
|---|---|
| Finalized blocks | 50 |
| Transactions per block | 0 to 5, mean 1.2 |
| Empty blocks | **78%**, matching the live node exactly (7 of 9) |
| Status mix | 100% finalized |
| Timestamp collisions | none |
| Ledger UTxOs | 200 |
| Deposits / withdrawals / forced | 20 / 10 / 5 |

### `target`

**Question: does it meet its budget at a plausible production size?** The profile every approved budget is measured against.

| Property | Value | Basis |
|---|---|---|
| Finalized blocks | 5,000 | Enough for page 100 at 25 per page, with headroom |
| Transactions per block | long tail, p50 1, p95 20, p99 60, max 200 | **ASSUMPTION.** See below |
| Empty blocks | **30%** | **APPROVED as a pessimistic challenge profile.** Live data is 78% empty; 30% is deliberately harsher because 78% would make most list pages trivially cheap and hide the cost the budgets exist to catch |
| Status mix | 92% finalized, 6% pending, 2% failed | **ASSUMPTION** |
| Timestamp collisions | 5% of blocks share `block_end_time` | I4 |
| Ledger UTxOs | 20,000 | Matches `SCAN_LIMIT`, so `asset-roster` is exercised at its own bound |
| Deposits / withdrawals / forced | 2,000 / 800 / 300 |
| Transaction body size | p50 383 B, p95 2 KB, p99 8 KB, max 64 KB | p50 from the live `immutable` measurement; the tail is an **ASSUMPTION** |
| `header_cbor` | p50 361 B, p95 1 KB | p50 measured live; tail assumed |

### `stress`

**Question: does it degrade gracefully rather than fall over?** Not a pass/fail profile; a shape check.

| Property | Value |
|---|---|
| Finalized blocks | 50,000 |
| Transactions per block | same shape, max 500 |
| Ledger UTxOs | 200,000 |
| Everything else | scaled proportionally |

## What is assumption, and who owns it

**The live database holds 9 blocks and 2 transactions. That cannot yield a distribution.** Every row below is a stated product assumption, not an observation, and needs an owner before any budget derived from it counts as evidence.

| Assumption | Current basis | Owner |
|---|---|---|
| Transactions per block distribution | None. Live data has 2 transactions across 9 blocks | **unassigned** |
| Status mix 92/6/2 | None. Live data is 100% finalized | **unassigned** |
| Empty-block rate 30% | Deliberate: harsher than the observed 78% | **APPROVED as a challenge profile** |
| Transaction body tail | p50 measured (383 B); p95/p99/max invented | **unassigned** |
| 5% timestamp collision rate | Chosen to make the tiebreak testable, not observed | Deliberate test-design choice, not a production claim |

Consequence, carried into the register per D16: a budget measured on `target` is **valid for comparing before and after a change** and **provisional for absolute pass/fail**. When a real deployment supplies a distribution, these rows are replaced and the affected baselines are re-measured.

## Generation mechanics

- `COPY FROM STDIN`, or batches sized so `rows × columns < 60,000`. The bind-parameter cap is 65,535 and `stress` writes millions of rows.
- Insert in foreign-key order: `pending_block_finalizations`, `pending_block_finalization_txs`, the four member tables, `deposits_utxos`, `withdrawal_utxos`, `forced_transaction_utxos`, `mempool_ledger`, `da_payloads`.
- `ANALYZE` after load. Without it the planner works from empty-table statistics and every plan captured is fiction.
- Record with each dataset: PostgreSQL version, `work_mem`, `shared_buffers`, `effective_cache_size`, CPU count, RAM, and the index snapshot checksum.
- The `stress` seed belongs to a benchmark suite, never the unit suite.

## Open questions for approval

1. **Who owns the five assumptions above?** They can be assigned, or sourced from a real deployment, or explicitly accepted as engineering estimates. All three are fine; leaving them unowned is not.
2. **Is 5,000 blocks the right `target`?** It is derived from "page 100 must exist", not from a forecast of the deployment.
3. ~~Empty-block rate~~ **RESOLVED 2026-09-04.** 30% approved as a pessimistic challenge profile. Recorded as a deliberate test-design choice, not a production forecast, so no downstream document may cite it as an observation.
