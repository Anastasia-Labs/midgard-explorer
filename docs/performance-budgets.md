# Performance budget register

**STATUS: LATENCY, RESOURCE AND CI TARGETS APPROVED, PENDING BASELINE. CODEBASE-HEALTH TARGETS PENDING APPROVAL.** The first three were approved 2026-09-04 and await a measurement, not a decision. The codebase-health table was written later and awaits a decision, so none of its rows is a gate yet. `DISCOVERY` rows carry no target and cannot pass or fail. Rows marked `INSUFFICIENT` lack the sample size to resolve their target and report that rather than passing.

Generated alongside `backend/bench/workloads.mts`, which is the machine-readable form. The test `backend/test/bench-workloads.test.mts` fails if a workload here has no catalogue entry, or vice versa.

## How to read this

- **Owner is always `explorer`.** Answering a request is ours even when the index it needs belongs to another team. That constraint is the **Dependency** column, never the owner.
- **Cache mode decides what a number means.** Every `/api/` route carries a five-second response cache by default (`backend/src/server/catalogue.ts:137`), so repeating one path measures the cache. `cold` measures the query, `warm` measures the cache deliberately, `unique-key` measures mixed traffic. **A database budget may never rest on a warm reading**, and the test enforces it.
- **Wire bytes are read from the response stream**, not from a decoded `fetch` body, so compression is visible. Every wire budget is paired with an identity-encoded budget so a ratio is computable per route.
- **`cold` means application-cache cold, both layers.** `/api/metrics` and `/api/assets` each have two: a `cachePublicJson` response entry and an inner `cached(...)` work entry with its own 10s TTL. `clearCache()` empties both but is in-process, so a cold run comes from restarting the process or a benchmark-only bypass gated off in production. It does **not** mean a cold PostgreSQL buffer cache; that is reported separately as shared blocks.
- **Buffer work is `hit + read`, not `read`.** A full scan served entirely from shared buffers reports zero reads. A read-only budget would pass it while it does exactly the work the budget exists to catch. Measured across both databases.
- **`DISCOVERY` rows cannot pass or fail.** They have no target yet and exist to produce one. They are excluded from the 10/10 criterion until they are converted to budgets.
- **Provenance says what a number is evidence of.** `real` comes from the explorer index, which holds 281 real preprod transactions and 2,767 IOs. `generated` comes from the seeded profiles, because the node database holds 9 blocks and 2 transactions and produces one block every 3.6 days on average, with nothing in 22 days. A `generated` number is valid for comparing before and after a change and provisional for absolute pass/fail.
- **`UNMEASURABLE` is not `PASS`.** A budget that current volume cannot exercise reports this. `OFFSET 2475` against 9 rows returns an empty page in about a millisecond; recording that as a pass would manufacture a false green on the budget the B+C decision rests on.
- **`BLOCKED` is not `PASS`.** A blocked budget with a shipped fallback means implementation scope is complete and the product is not at 10/10.

## Profiles

Defined in `backend/bench/profiles.mts` (built during `DATASETS`). Distributions, not uniform grids.

| Profile | Blocks | Txs per block | Status mix | Timestamp collisions | Ledger UTxOs |
|---|---:|---|---|---|---:|
| `small` | 50 | 0 to 5, skewed | 100% `finalized`, no active row | none | 200 |
| `target` | 5,000 | 1 to 60, long tail | 98% `finalized` / 2% `abandoned`, plus **exactly one** non-terminal row | ~5% share a `block_end_time` | **≥25,000** (measured 30,479) |
| `stress` | 50,000 | long tail to 500 | same, one non-terminal row | ~5% | 200,000 |

**There is no `failed` status**, and the non-terminal states are not a percentage. `uniq_pending_block_finalizations_single_active` is a unique index on a constant with a partial predicate, so the database holds at most one non-terminal row in total. An earlier draft of this table asked for 300 of them.

**A floor of 25,000 rather than exactly 20,000 ledger UTxOs**: `getSpendableLedger` reports `truncated: total > rows.length` against `SCAN_LIMIT = 20_000`, so at exactly 20,000 the truncation path is never taken and `asset-roster` measures the easy case while appearing to measure the hard one. The figure is a floor because the block count and the output shapes determine the actual size, which measures 30,479.

The status mix and the transaction distributions are **documented engineering assumptions**, not observations: the live database holds 9 finalized blocks and 2 journaled transactions, which cannot yield a distribution. Ruled 2026-09-04: explorer engineering owns them, with mandatory recalibration once real persisted data can supply a distribution.

## Latency and work budgets

| Budget | Measured baseline | Target (approved) | **Provenance** | Profile | Cache mode | Owner | Dependency | Verification command | Status | Fallback if blocked |
|---|---|---|---|---|---|---|---|---|---|---|
| `blocks-list-page-1` | not measured | p95 200 ms / p99 400 ms, ≤4 statements, 0 temp bytes | `generated` | target | cold | explorer | UR-1 | `bench/harness.mts --workload blocks-list-page-1` | PENDING BASELINE | Cursor pagination plus a hard depth cap |
| `blocks-list-page-deep` | not measured | p95 300 ms / p99 600 ms, ≤4 statements, 0 temp bytes | `generated` | target | cold | explorer | UR-1 | `bench/harness.mts --workload blocks-list-page-deep` | PENDING BASELINE | Depth cap with a documented error past it |
| `transactions-list-page-1` | not measured | p95 200 ms / p99 400 ms, ≤4 statements | `generated` | target | cold | explorer | UR-1 | `bench/harness.mts --workload transactions-list-page-1` | PENDING BASELINE | As above |
| `transactions-list-page-deep` | not measured | p95 300 ms / p99 600 ms, ≤4 statements | `generated` | target | cold | explorer | UR-1 | `bench/harness.mts --workload transactions-list-page-deep` | PENDING BASELINE | As above |
| `block-detail` | not measured | p95 250 ms / p99 500 ms, ≤8 statements, ≤128 KB wire, ≤512 KB identity | `generated` | target | unique-key | explorer | none | `bench/harness.mts --workload block-detail` | PENDING BASELINE | **Bound the decoded transaction rows first**, see below |
| `transaction-detail` | not measured | p95 250 ms / p99 500 ms, ≤8 statements, ≤192 KB wire, ≤768 KB identity | `generated` | target | unique-key | explorer | none | `bench/harness.mts --workload transaction-detail` | PENDING BASELINE | Lower `MAX_INLINE_CBOR_BYTES` from 64 KB |
| `search-prefix` | not measured | p95 400 ms / p99 800 ms, ≤200k shared blocks (`hit + read`) | `real+extended` | target | unique-key | explorer | none | `bench/harness.mts --workload search-prefix` | PENDING BASELINE | Raise `MIN_PREFIX`; or an expression index, which is upstream-owned |
| `metrics` | not measured | p95 500 ms / p99 1,000 ms, ≤9 statements | `generated` | target | cold | explorer | none | `bench/harness.mts --workload metrics` | PENDING BASELINE | Split the panel into independent snapshots |
| `metrics-cached` | not measured | p95 20 ms / p99 40 ms | `generated` | target | warm | explorer | none | `bench/harness.mts --workload metrics-cached` | PENDING BASELINE | n/a, this measures the cache on purpose |
| `asset-roster` | not measured | p95 800 ms / p99 1,600 ms, ≤2 statements | `generated` | target | cold | explorer | none | `bench/harness.mts --workload asset-roster` | PENDING BASELINE | Lower `SCAN_LIMIT` and report reduced coverage |
| `address-history` | not measured | p95 250 ms / p99 500 ms, ≤6 statements | `real+extended` | target | unique-key | explorer | none | `bench/harness.mts --workload address-history` | PENDING BASELINE | Cursor pagination |
| `overview-aggregate` | not measured | p95 600 ms / p99 1,200 ms, ≤256 KB wire, ≤1 MB identity | `generated` | target | cold | explorer | none | `bench/harness.mts --workload overview-aggregate` | PENDING BASELINE | One backend aggregate route |
| `blocks-list-saturation` | not measured | p95 1,500 ms / p99 3,000 ms at concurrency 32, **≥20 req/s**, timeouts ≤0.1%, errors ≤1% | `generated` | target | unique-key | explorer | UR-1 | `bench/harness.mts --workload blocks-list-saturation` | PENDING BASELINE | Raise pool `max`, or shed load at the edge |

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

## Codebase health budgets

The five dimensions of the original assessment that no latency, resource or CI row measures. Without these the register could read all-`PASS` while dead weight, duplication and change cost sit where they are today.

**These targets are PROPOSED, not approved.** Every other table in this document carries numbers the owner approved on 2026-09-04. No ruling has been made on these, and **no row here may be cited as a gate until it is approved**. Resolve before `BASELINES`.

**Baselines measured 2026-09-04**, so the targets are now set against observation rather than invented. Two corrections came out of measuring:

- **The 82-second frontend suite figure was stale.** Three runs give 32.7 s median with a 0.7 s spread. The overhead *share* is the real problem and did not improve: 19.3 s of environment against 3.8 s of execution.
- **The original duplication target passed trivially.** At 40 lines the codebase has zero clones, so the gate would have measured nothing. Measured at 12 lines it is 0.90%, which is a number that can move.

| Budget | Measured baseline | Target (PROPOSED) | Owner | Verification command | Status |
|---|---|---|---|---|---|
| Frontend total client JS | **848.6 KB gzipped over 28 chunks; the largest single chunk is 422.8 KB, half of all client JS** | total ≤900 KB gzipped, largest chunk ≤250 KB | explorer | `.next/static/chunks`, gzipped | PENDING APPROVAL |
| **Frontend test suite wall time** | **32.7 s median of 3 runs (33.28, 32.68, 32.56), 468 tests** | ≤20 s | explorer | `pnpm vitest run` in `frontend-new/app` | PENDING APPROVAL |
| **Frontend test suite overhead share** | **88%: 19.3 s environment and 3.8 s execution of 32.7 s** | ≤60% | explorer | same, 1 minus execution over total | PENDING APPROVAL |
| Backend test suite wall time | **96.6 to 127.1 s over 3 runs, 689 tests**, a 31% spread | ≤120 s, once the spread is characterised | explorer | `pnpm vitest run` in `backend` | PENDING APPROVAL |
| Backend test suite flakiness | one unexplained serial failure, cause unknown | 0 failures in 50 consecutive runs | explorer | `CI-ISOLATION` | PENDING APPROVAL |
| Dead weight retirement | 47 tracked files under `frontend/`, unretired | **every** dead or legacy artifact carries an explicit decision: retire, archive, or keep with a stated reason. Zero undecided | explorer | inventory in `LEGACY-RETIREMENT`, one row per artifact | PENDING APPROVAL |
| Duplication | **0.90%: 15 clones, 265 lines over 203 files** at 12 lines / 50 tokens. Zero at 40 lines | ≤1.5% at 12 lines / 50 tokens | explorer | `jscpd --min-lines 12 --min-tokens 50` over `backend/src` and `frontend-new` | PENDING APPROVAL |
| Change complexity | **top-10 churn peaks at 524 lines (`indexer/sync.ts`), then 418 (`indexer/koios.ts`); largest source file is 637 (`decode/transaction.ts`), largest tracked is 871 (an e2e spec)** | the 10 highest-churn files each under 400 lines; no file over 800 lines without a stated reason | explorer | `git log --numstat` churn crossed with line counts | PENDING APPROVAL |
| Fixture representativeness | not measurable until the fixture pipeline exists | every fixture response validates against its contract, and the set covers every route the demo server serves plus the empty, truncated and error cases | explorer | fixture build, which fails on a contract violation | PENDING APPROVAL |

**Dead weight, duplication and change complexity are gates, not observations.** A retirement decision may be "keep it", but there is no such thing as an artifact with no decision. That is the whole failure mode: an undecided artifact reads as a pass because nobody wrote down that it fails.

## Lifecycle

Targets were approved on 2026-09-04. Rows move through these states and no other:

| State | Meaning |
|---|---|
| `PENDING BASELINE` | Target approved, no measurement yet. Every latency, resource and CI row is here |
| `PENDING APPROVAL` | Target **proposed and not approved**. Cannot be cited as a gate. Every codebase-health row is here |
| `DISCOVERY` | No target by decision. Exists to produce one. Cannot pass or fail, and is excluded from the 10/10 criterion |
| `INSUFFICIENT` | Measured, but the sample cannot resolve the target. Reports this rather than passing |
| `UNMEASURABLE` | Current data volume cannot exercise the target. Reports this rather than passing |
| `PASS` / `FAIL` | Measured against an approved target |
| `BLOCKED` | Fails on an open dependency with a shipped fallback. **Not `PASS`**: implementation scope can be complete while the product is below 10/10 |

`BASELINES` moves every `PENDING BASELINE` row to `PASS`, `FAIL`, `BLOCKED` or `INSUFFICIENT`. Nothing returns to an approval state; a target change is a new approval, recorded here with its date.
