# Performance budget register

**STATUS: TARGETS APPROVED, PENDING BASELINE.** Approved 2026-09-04. Every row now awaits a measurement, not a decision. `DISCOVERY` rows carry no target and cannot pass or fail. Rows marked `INSUFFICIENT` lack the sample size to resolve their target and report that rather than passing.

Generated alongside `backend/bench/workloads.mts`, which is the machine-readable form. The test `backend/test/bench-workloads.test.mts` fails if a workload here has no catalogue entry, or vice versa.

## How to read this

- **Owner is always `explorer`.** Answering a request is ours even when the index it needs belongs to another team. That constraint is the **Dependency** column, never the owner.
- **Cache mode decides what a number means.** Every `/api/` route carries a five-second response cache by default (`backend/src/server/catalogue.ts:137`), so repeating one path measures the cache. `cold` measures the query, `warm` measures the cache deliberately, `unique-key` measures mixed traffic. **A database budget may never rest on a warm reading**, and the test enforces it.
- **Wire bytes are read from the response stream**, not from a decoded `fetch` body, so compression is visible. Every wire budget is paired with an identity-encoded budget so a ratio is computable per route.
- **`cold` means application-cache cold, both layers.** `/api/metrics` and `/api/assets` each have two: a `cachePublicJson` response entry and an inner `cached(...)` work entry with its own 10s TTL. `clearCache()` empties both but is in-process, so a cold run comes from restarting the process or a benchmark-only bypass gated off in production. It does **not** mean a cold PostgreSQL buffer cache; that is reported separately as shared blocks.
- **Buffer work is `hit + read`, not `read`.** A full scan served entirely from shared buffers reports zero reads. A read-only budget would pass it while it does exactly the work the budget exists to catch. Measured across both databases.
- **`DISCOVERY` rows cannot pass or fail.** They have no target yet and exist to produce one. They are excluded from the 10/10 criterion until they are converted to budgets.
- **`BLOCKED` is not `PASS`.** A blocked budget with a shipped fallback means implementation scope is complete and the product is not at 10/10.

## Profiles

Defined in `backend/bench/profiles.mts` (built during `DATASETS`). Distributions, not uniform grids.

| Profile | Blocks | Txs per block | Status mix | Timestamp collisions | Ledger UTxOs |
|---|---:|---|---|---|---:|
| `small` | 50 | 1 to 5, skewed | mostly finalized | none | 200 |
| `target` | 5,000 | 1 to 60, long tail | finalized / pending / failed | ~5% share a `block_end_time` | 20,000 |
| `stress` | 50,000 | long tail to 200 | same mix | ~5% | 200,000 |

The status mix is a **documented product assumption**, not an observation: the live database holds 9 finalized blocks and 2 journaled transactions, which cannot yield a distribution. It needs an owner or a real deployment sample before any budget derived from it is treated as evidence.

## Latency and work budgets

| Budget | Measured baseline | Target (approved) | Profile | Cache mode | Owner | Dependency | Verification command | Status | Fallback if blocked |
|---|---|---|---|---|---|---|---|---|---|
| `blocks-list-page-1` | not measured | p95 200 ms / p99 400 ms, ≤4 statements, 0 temp bytes | target | cold | explorer | UR-1 | `bench/harness.mts --workload blocks-list-page-1` | PENDING BASELINE | Cursor pagination plus a hard depth cap |
| `blocks-list-page-deep` | not measured | p95 300 ms / p99 600 ms, ≤4 statements, 0 temp bytes | target | cold | explorer | UR-1 | `bench/harness.mts --workload blocks-list-page-deep` | PENDING BASELINE | Depth cap with a documented error past it |
| `transactions-list-page-1` | not measured | p95 200 ms / p99 400 ms, ≤4 statements | target | cold | explorer | UR-1 | `bench/harness.mts --workload transactions-list-page-1` | PENDING BASELINE | As above |
| `transactions-list-page-deep` | not measured | p95 300 ms / p99 600 ms, ≤4 statements | target | cold | explorer | UR-1 | `bench/harness.mts --workload transactions-list-page-deep` | PENDING BASELINE | As above |
| `block-detail` | not measured | p95 250 ms / p99 500 ms, ≤8 statements, ≤128 KB wire, ≤512 KB identity | target | unique-key | explorer | none | `bench/harness.mts --workload block-detail` | PENDING BASELINE | **Bound the decoded transaction rows first**, see below |
| `transaction-detail` | not measured | p95 250 ms / p99 500 ms, ≤8 statements, ≤192 KB wire, ≤768 KB identity | target | unique-key | explorer | none | `bench/harness.mts --workload transaction-detail` | PENDING BASELINE | Lower `MAX_INLINE_CBOR_BYTES` from 64 KB |
| `search-prefix` | not measured | p95 400 ms / p99 800 ms, ≤200k shared blocks (`hit + read`) | target | unique-key | explorer | none | `bench/harness.mts --workload search-prefix` | PENDING BASELINE | Raise `MIN_PREFIX`; or an expression index, which is upstream-owned |
| `metrics` | not measured | p95 500 ms / p99 1,000 ms, ≤9 statements | target | cold | explorer | none | `bench/harness.mts --workload metrics` | PENDING BASELINE | Split the panel into independent snapshots |
| `metrics-cached` | not measured | p95 20 ms / p99 40 ms | target | warm | explorer | none | `bench/harness.mts --workload metrics-cached` | PENDING BASELINE | n/a, this measures the cache on purpose |
| `asset-roster` | not measured | p95 800 ms / p99 1,600 ms, ≤2 statements | target | cold | explorer | none | `bench/harness.mts --workload asset-roster` | PENDING BASELINE | Lower `SCAN_LIMIT` and report reduced coverage |
| `address-history` | not measured | p95 250 ms / p99 500 ms, ≤6 statements | target | unique-key | explorer | none | `bench/harness.mts --workload address-history` | PENDING BASELINE | Cursor pagination |
| `overview-aggregate` | not measured | p95 600 ms / p99 1,200 ms, ≤256 KB wire, ≤1 MB identity | target | cold | explorer | none | `bench/harness.mts --workload overview-aggregate` | PENDING BASELINE | One backend aggregate route |
| `blocks-list-saturation` | not measured | p95 1,500 ms / p99 3,000 ms at concurrency 32, **≥20 req/s**, timeouts ≤0.1%, errors ≤1% | target | unique-key | explorer | UR-1 | `bench/harness.mts --workload blocks-list-saturation` | PENDING BASELINE | Raise pool `max`, or shed load at the edge |

### The block-detail fallback, corrected

The dominant payload is **not** `header_cbor` at 361 bytes. `routes/block.ts:103-115` decodes **every** transaction in the block into a full `TransactionView` with inputs, outputs, datums, scripts and redeemers, and the member query at `db/block.ts:38` has **no `LIMIT`**. At the `target` profile's long tail of up to 60 transactions per block, that is what will breach the budget.

Fallbacks in order: paginate or cap the decoded transaction rows and report the cap; then return summaries rather than full views in the block context, with the full view on the transaction route; then move `header_cbor` and `base_tail_datum_cbor` to an opt-in route. The last one alone cannot rescue this budget.

`address-history` deliberately carries no dependency: it sorts on `time_stamp_tz`, which **is** indexed upstream on `immutable`, `mempool` and `processed_mempool`. If it fails, the missing `block_end_time` index is not the diagnosis.

## Resource, delivery and payload budgets

| Budget | Measured baseline | Target (approved) | Owner | Dependency | Verification command | Status |
|---|---|---|---|---|---|---|
| Backend peak RSS, `target` profile | not measured | ≤512 MB | explorer | none | `backend/scripts/measure.mjs .. peak` | PENDING BASELINE |
| Frontend `next build` peak | between 1,024 and 1,536 MB (`docs/resource-requirements.md`) | ≤1,536 MB | explorer | none | `frontend-new/app/scripts/measure.mjs` | PENDING BASELINE |
| Frontend `next dev` floor | between 768 and 896 MB (same source) | ≤896 MB | explorer | none | same | PENDING BASELINE |
| Compression never enlarges an eligible response | not measured | encoded ≤ identity for every response over 1 KB, measured as identity vs encoded bytes | explorer | none | `curl -H 'Accept-Encoding: gzip, br' -D -` vs `-H 'Accept-Encoding: identity'` | PENDING BASELINE |
| Aggregate compression reduction | not measured | ≥40% across the JSON route set, weighted by traffic | explorer | none | same, summed over the workload set | PENDING BASELINE |
| Per-route wire size | not measured | the `maxWireBytes` column above | explorer | none | harness | PENDING BASELINE |
| Index-pass duration | not measured | none | explorer | none | `bench/harness.mts --index-pass` | **DISCOVERY** |
| Index throughput, L1 txs per minute | not measured | none | explorer | none | same | **DISCOVERY** |
| Web Vitals, production | discarded today (`WebVitals.tsx:5` logs only outside production) | **p75** LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1; per route class (list / detail / overview) and device class (mobile / desktop); rolling **28-day** window; **≥1,000 samples per route-and-device cell**, otherwise the cell reports INSUFFICIENT rather than passing | explorer | `TELEMETRY` | production telemetry endpoint | PENDING BASELINE |

The two frontend memory rows are the only ones carrying a real measured baseline. It predates this register and comes from `docs/resource-requirements.md`, not from the harness.

## CI budgets

Four separate measures. A blended failure rate hides which is which, and **a gate correctly rejecting broken code is not inefficiency**.

**Sample size.** A ≤2% rate cannot be resolved by 20 observations: zero failures in 20 runs is consistent with a true rate near 10%. Minimum **50 runs**, rolling **100** preferred. Until the window reaches 50, these rows report INSUFFICIENT rather than passing.

| Budget | Measured baseline | Target (approved) | Owner | Verification command | Status |
|---|---|---|---|---|---|
| Median wall time | **10.75 min** (median of the last 10 runs; the range was 9.6 to 14.3) | ≤8 min | explorer | `gh run list --limit 100 --json createdAt,updatedAt` | PENDING BASELINE |
| Infrastructure flake rate | not classified, n=10 (INSUFFICIENT) | ≤2% over ≥50 runs | explorer | classification table, `CI-ISOLATION` | PENDING BASELINE |
| Rerun disagreement rate | not measured (INSUFFICIENT) | ≤2% over ≥50 runs | explorer | rerun each failure in the window | PENDING BASELINE |
| First-pass PR rate | not measured (INSUFFICIENT) | ≥70% over ≥50 PRs | explorer | `gh pr list --state merged --limit 100` | PENDING BASELINE |

The wall-time median is a real observation from `gh run list`, over 10 runs, which is enough for a median but not for a rate. The other three are unmeasured: the last 10 runs held 7 or 8 failures depending on sampling time, **none classified**, and 10 observations cannot resolve a 2% target either way.

## Lifecycle

Targets were approved on 2026-09-04. Rows move through these states and no other:

| State | Meaning |
|---|---|
| `PENDING BASELINE` | Target approved, no measurement yet. Every latency, resource and CI row is here |
| `DISCOVERY` | No target by decision. Exists to produce one. Cannot pass or fail, and is excluded from the 10/10 criterion |
| `INSUFFICIENT` | Measured, but the sample cannot resolve the target. Reports this rather than passing |
| `PASS` / `FAIL` | Measured against an approved target |
| `BLOCKED` | Fails on an open dependency with a shipped fallback. **Not `PASS`**: implementation scope can be complete while the product is below 10/10 |

`BASELINES` moves every `PENDING BASELINE` row to `PASS`, `FAIL`, `BLOCKED` or `INSUFFICIENT`. Nothing returns to an approval state; a target change is a new approval, recorded here with its date.
