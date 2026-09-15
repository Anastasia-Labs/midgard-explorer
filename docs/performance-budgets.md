# Performance budget register

**STATUS: THE BACKEND TARGET BASELINE IS MEASURED.** Every backend latency, database, payload and resource row now carries a verdict from one artifact, [`efc9af69`](performance/baselines/target-efc9af69.json): ten workloads pass and two fail. Rows this run cannot settle say why rather than staying silent: `overview-aggregate` is `BLOCKED` on a frontend harness, Web Vitals on `TELEMETRY`, and the three CI quality rows are `INSUFFICIENT` at n=10 against targets naming 50. Backend suite wall time still awaits a standardised runner, and the `stress` profile, which now generates in batches (6.8 million rows, 3.2 GB, 667 MB peak heap), awaits a run on a machine that meets the 30 GB and quiet-load gates. The codebase-health targets were ruled 2026-09-04: five unchanged, three revised, one deferred.

Generated alongside `backend/bench/workloads.mts`, which is the machine-readable form. The test `backend/test/bench-workloads.test.mts` fails if a workload here has no catalogue entry, or vice versa.

## How to read this

- **Owner is always `explorer`.** Answering a request is ours even when the index it needs belongs to another team. That constraint is the **Dependency** column, never the owner.
- **Cache mode decides what a number means.** Every `/api/` route carries a five-second response cache by default (`backend/src/server/catalogue.ts:137`), so repeating one path measures the cache. `cold` measures the query, `warm` measures the cache deliberately, `unique-key` measures mixed traffic. **A database budget may never rest on a warm reading**, and the test enforces it. A `unique-key` row also requires one distinct key per request: the harness counts the paths it issued and every budget becomes `UNMEASURED` if they repeat, or if the count is not reported at all. `blocks-list-saturation` is `cold` for that reason. Its key is a page number and the seeded pages are far fewer than a saturation run's requests, so at concurrency 32 the repeats coalesced onto one in-flight cached promise and the row measured the cache deduplicating work rather than the queueing it exists to measure.
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

**What the measured column is.** Every figure comes from one run, [`target-efc9af69.json`](performance/baselines/target-efc9af69.json), taken at the `target` profile against **generated** data on the `existing-minimum-2-core` hardware profile, with 1,000 successful responses per workload and no unmeasured budget. The harness built the artifact it measured from that commit and refused to certify a dirty tree, so the number and the source agree. It is a baseline, not a forecast: the `generated` rows rest on the documented engineering assumptions above, and a production figure on other hardware will differ. The targets beside them are unchanged and were approved before the run.

**A statement budget counts route queries.** Every request also pays a fixed `BEGIN`, `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` and `COMMIT`, and the two detail routes pay it twice because they read both databases. That preamble is snapshot consistency, not something a query change can remove, and counting it put `asset-roster`'s budget of two below the three-statement floor. It is recorded in each row and judged in none. Ruled 2026-09-05.

**Nothing is compressed, anywhere.** The origin has no compression middleware and no such dependency, and the edge proxy ships with `gzip` commented out and no directive in `infra/nginx/explorer-api.conf.template`. Asking for `gzip, br` returns exactly the identity bytes on all eleven eligible routes, so `address-history` sends 1.8 MB uncompressed. That is why the aggregate reduction row reads 0.0% against a 40% target, and why the row above it passes vacuously: a response that is never encoded can never be enlarged by encoding.

Eight of the twelve breach a **statement count** and nothing else, apart from one temp-I/O breach. **No latency budget fails anywhere.** The optimisation work therefore starts from query counts, not from response times.

| Budget | Measured baseline | Target (approved) | **Provenance** | Profile | Cache mode | Owner | Dependency | Verification command | Status | Fallback if blocked |
|---|---|---|---|---|---|---|---|---|---|---|
| `blocks-list-page-1` | p50 35.9 / p95 40.2 / p99 48.3 ms, 2.00 route statements (+3.00 control, +0.00 metadata), 9.1 KB wire, 9.1 KB identity | p95 200 ms / p99 400 ms, ≤4 statements, 0 temp bytes | `generated` | target | cold | explorer | UR-1 | `pnpm bench --only blocks-list-page-1 --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Cursor pagination plus a hard depth cap |
| `blocks-list-page-deep` | p50 36.5 / p95 40.5 / p99 49.8 ms, 2.00 route statements (+3.00 control, +0.00 metadata), 9.1 KB wire, 9.1 KB identity | p95 300 ms / p99 600 ms, ≤4 statements, 0 temp bytes | `generated` | target | cold | explorer | UR-1 | `pnpm bench --only blocks-list-page-deep --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Depth cap with a documented error past it |
| `transactions-list-page-1` | p50 58.3 / p95 65.2 / p99 73.5 ms, 2.00 route statements (+3.00 control, +0.00 metadata), 66.7 KB wire, 66.7 KB identity | p95 200 ms / p99 400 ms, ≤4 statements | `generated` | target | cold | explorer | UR-1 | `pnpm bench --only transactions-list-page-1 --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | As above |
| `transactions-list-page-deep` | p50 61.7 / p95 75.0 / p99 93.7 ms, 2.00 route statements (+3.00 control, +0.00 metadata), 3538.2 KB temp, 48.8 KB wire, 48.8 KB identity | p95 300 ms / p99 600 ms, ≤4 statements | `generated` | target | cold | explorer | UR-1 | `pnpm bench --only transactions-list-page-deep --mode smoke` | FAIL [`efc9af69`](performance/baselines/target-efc9af69.json) | As above |
| `block-detail` | p50 24.8 / p95 33.7 / p99 46.6 ms, 10.01 route statements (+6.00 control, +3.00 metadata), 7.3 KB wire, 30.6 KB identity | p95 250 ms / p99 500 ms, ≤8 statements, ≤128 KB wire, ≤512 KB identity | `generated` | target | unique-key | explorer | none | `pnpm bench --only block-detail --mode smoke` | FAIL [`efc9af69`](performance/baselines/target-efc9af69.json) | **Bound the decoded transaction rows first**, see below |
| `transaction-detail` | p50 15.5 / p95 20.2 / p99 26.0 ms, 7.00 route statements (+6.00 control, +3.00 metadata), 5.0 KB wire, 4.3 KB identity | p95 250 ms / p99 500 ms, ≤8 statements, ≤192 KB wire, ≤768 KB identity | `generated` | target | unique-key | explorer | none | `pnpm bench --only transaction-detail --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Lower `MAX_INLINE_CBOR_BYTES` from 64 KB |
| `search-prefix` | p50 21.2 / p95 24.9 / p99 29.3 ms, 6.00 route statements (+3.00 control, +0.00 metadata), 5384 shared blocks, 0.1 KB wire, 0.1 KB identity | p95 400 ms / p99 800 ms, ≤200k shared blocks (`hit + read`) | `real+extended` | target | unique-key | explorer | none | `pnpm bench --only search-prefix --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Raise `MIN_PREFIX`; or an expression index, which is upstream-owned |
| `metrics` | p50 58.3 / p95 66.4 / p99 72.1 ms, 9.00 route statements (+3.00 control, +0.00 metadata), 14920.0 KB temp, 3.1 KB wire, 3.1 KB identity | p95 500 ms / p99 1,000 ms, ≤9 statements | `generated` | target | cold | explorer | none | `pnpm bench --only metrics --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Split the panel into independent snapshots |
| `metrics-cached` | p50 0.6 / p95 0.8 / p99 1.6 ms, 0.00 route statements (+0.00 control, +0.00 metadata), 3.1 KB wire, 3.1 KB identity | p95 20 ms / p99 40 ms | `generated` | target | warm | explorer | none | `pnpm bench --only metrics-cached --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | n/a, this measures the cache on purpose |
| `asset-roster` | p50 218.2 / p95 247.1 / p99 269.7 ms, 2.00 route statements (+3.00 control, +0.00 metadata), 14400.0 KB temp, 18.4 KB wire, 18.4 KB identity | p95 800 ms / p99 1,600 ms, ≤2 statements | `generated` | target | cold | explorer | none | `pnpm bench --only asset-roster --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Lower `SCAN_LIMIT` and report reduced coverage |
| `address-history` | p50 206.0 / p95 236.7 / p99 279.0 ms, 3.00 route statements (+3.00 control, +0.00 metadata), 96700.7 KB temp, 85.5 KB wire, 1821.6 KB identity | p95 250 ms / p99 500 ms, ≤6 statements | `real+extended` | target | unique-key | explorer | none | `pnpm bench --only address-history --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Cursor pagination |
| `overview-aggregate` | not measured | p95 600 ms / p99 1,200 ms, ≤256 KB wire, ≤1 MB identity | `generated` | target | cold | explorer | none | `pnpm bench --only overview-aggregate --mode smoke` | BLOCKED: frontend origin, so the backend sweep cannot serve it; needs a frontend harness | One backend aggregate route |
| `blocks-list-saturation` | p50 659.8 / p95 719.0 / p99 741.6 ms, 48.5 req/s, 0.00% errors, 0.00% timeouts, 2.00 route statements (+3.00 control, +0.00 metadata), 9.1 KB wire, 9.1 KB identity | p95 1,500 ms / p99 3,000 ms at concurrency 32, **≥20 req/s**, timeouts ≤0.1%, errors ≤1% | `generated` | target | cold | explorer | UR-1 | `pnpm bench --only blocks-list-saturation --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Raise pool `max`, or shed load at the edge |

### The block-detail fallback, corrected

The dominant payload is **not** `header_cbor` at 361 bytes. `routes/block.ts:103-115` decodes **every** transaction in the block into a full `TransactionView` with inputs, outputs, datums, scripts and redeemers, and the member query at `db/block.ts:38` has **no `LIMIT`**. At the `target` profile's long tail of up to 60 transactions per block, that is what will breach the budget.

Fallbacks in order: paginate or cap the decoded transaction rows and report the cap; then return summaries rather than full views in the block context, with the full view on the transaction route; then move `header_cbor` and `base_tail_datum_cbor` to an opt-in route. The last one alone cannot rescue this budget.

`address-history` draws the **1,000 busiest distinct addresses**, each requested once, equally weighted. That is the population the budget is about: a uniformly drawn address has a single entry and its page measures nothing, so the row would pass on addresses nobody looks up. With one request per address the p95 describes roughly the slowest 50 of those thousand and the p99 roughly the slowest 10. It is deliberately not a cold worst-case: repeating only the busiest 50 would measure a different thing, and if that is wanted later it belongs in its own row rather than silently inside this one.

`address-history` deliberately carries no dependency: it sorts on `time_stamp_tz`, which **is** indexed upstream on `immutable`, `mempool` and `processed_mempool`. If it fails, the missing `block_end_time` index is not the diagnosis.

## Resource, delivery and payload budgets

| Budget | Measured baseline | Target (approved) | Owner | Dependency | Verification command | Status |
|---|---|---|---|---|---|---|
| Backend peak RSS, `target` profile | **737.3 MB** [`efc9af69`](performance/baselines/target-efc9af69.json) | ≤512 MB | explorer | none | `pnpm bench --profile target --mode baseline` (`peakRssBytes`) | FAIL |
| Frontend `next build` peak | between 1,024 and 1,536 MB (`docs/resource-requirements.md`, measured on this two-core machine) | ≤1,536 MB | explorer | none | `frontend-new/app/scripts/measure.mjs` | PASS at the boundary: the upper bound equals the target, so any growth breaches it |
| Frontend `next dev` floor | between 768 and 896 MB (same source) | ≤896 MB | explorer | none | same | PASS at the boundary: as above |
| Compression never enlarges an eligible response | **0 of 11** responses over 1 KB grew when encoded (vacuous: no response is encoded at all, so none can grow) [`efc9af69`](performance/baselines/target-efc9af69.json) | encoded ≤ identity for every response over 1 KB, measured as identity vs encoded bytes | explorer | none | harness, `encodedBytes` vs `uncompressedBytes` on one url | PASS (vacuous, see below) |
| Aggregate compression reduction | **0.0%** over 11 eligible routes (2023.7 KB identity to 2023.7 KB encoded) [`efc9af69`](performance/baselines/target-efc9af69.json) | ≥40% across the JSON route set, weighted by traffic | explorer | none | harness, summed over the workload set | FAIL |
| Per-route wire size | `blocks-list-page-1` 9.1 KB, `blocks-list-page-deep` 9.1 KB, `transactions-list-page-1` 66.7 KB, `transactions-list-page-deep` 48.8 KB, `block-detail` 7.3 KB, `transaction-detail` 5.0 KB, `search-prefix` 0.1 KB, `metrics` 3.1 KB, `metrics-cached` 3.1 KB, `asset-roster` 18.4 KB, `address-history` 85.5 KB, `blocks-list-saturation` 9.1 KB [`efc9af69`](performance/baselines/target-efc9af69.json) | the `maxWireBytes` column above | explorer | none | harness | PASS: no row breached its wire budget |
| Index-pass duration | not measured | none | explorer | none | no command yet: this row exists to produce one | **DISCOVERY** |
| Index throughput, L1 txs per minute | not measured | none | explorer | none | same | **DISCOVERY** |
| Web Vitals, production | discarded today (`WebVitals.tsx:5` logs only outside production) | **p75** LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1; per route class (list / detail / overview) and device class (mobile / desktop); rolling **28-day** window; **≥1,000 samples per route-and-device cell**, otherwise the cell reports INSUFFICIENT rather than passing | explorer | `TELEMETRY` | production telemetry endpoint | BLOCKED on `TELEMETRY`: nothing is collected in production yet |

The two frontend memory rows are the only ones carrying a real measured baseline. It predates this register and comes from `docs/resource-requirements.md`, not from the harness.

## CI budgets

Four separate measures. A blended failure rate hides which is which, and **a gate correctly rejecting broken code is not inefficiency**.

**Sample size.** A ≤2% rate cannot be resolved by 20 observations: zero failures in 20 runs is consistent with a true rate near 10%. Minimum **50 runs**, rolling **100** preferred. Until the window reaches 50, these rows report INSUFFICIENT rather than passing.

| Budget | Measured baseline | Target (approved) | Owner | Verification command | Status |
|---|---|---|---|---|---|
| Median wall time | **10.75 min** (median of the last 10 runs; the range was 9.6 to 14.3) | ≤8 min | explorer | `gh run list --limit 100 --json createdAt,updatedAt` | FAIL |
| Infrastructure flake rate | not classified, n=10 (INSUFFICIENT) | ≤2% over ≥50 runs | explorer | classification table, `CI-ISOLATION` | INSUFFICIENT: n=10 against a target that names ≥50 runs |
| Rerun disagreement rate | not measured (INSUFFICIENT) | ≤2% over ≥50 runs | explorer | rerun each failure in the window | INSUFFICIENT: no reruns recorded against a target that names ≥50 |
| First-pass PR rate | not measured (INSUFFICIENT) | ≥70% over ≥50 PRs | explorer | `gh pr list --state merged --limit 100` | INSUFFICIENT: n well under the ≥50 PRs the target names |

The wall-time median is a real observation from `gh run list`, over 10 runs, which is enough for a median but not for a rate. The other three are unmeasured: the last 10 runs held 7 or 8 failures depending on sampling time, **none classified**, and 10 observations cannot resolve a 2% target either way.

## Codebase health budgets

The five dimensions of the original assessment that no latency, resource or CI row measures. Without these the register could read all-`PASS` while dead weight, duplication and change cost sit where they are today.

**Ruled 2026-09-04.** Five approved unchanged, three revised, one deferred. Only the deferred row still blocks `BASELINES`.

**Why the bundle rows are ratchets, not limits.** The 422.8 KB chunk is the lazily instantiated ELK layout worker (`UtxoFlowCanvas.tsx:118`, behind `needsElk` and a `typeof Worker` guard), so it is not initial-load JS and a 250 KB cap on it would gate the wrong thing. Verified: the chunk contains 352 `elk` references and no route imports it eagerly. A no-regression ratchet holds the line until the analyzer can give real per-route initial-load figures, which is the `DISCOVERY` row below.

**Why environment time replaced the overhead ratio.** A ratio of overhead to total is gameable in the wrong direction: adding slow assertions improves it while making the suite worse. An absolute environment-time target cannot be satisfied that way.

**Why duplication tightened to 1.0%.** ≤1.5% against a 0.90% baseline would licence a 67% regression and still read green.

**Baselines measured 2026-09-04**, so the targets are now set against observation rather than invented. Two corrections came out of measuring:

- **The 82-second frontend suite figure was stale.** Three runs give 32.7 s median with a 0.7 s spread. The overhead *share* is the real problem and did not improve: 19.3 s of environment against 3.8 s of execution.
- **The original duplication target passed trivially.** At 40 lines the codebase has zero clones, so the gate would have measured nothing. Measured at 12 lines it is 0.90%, which is a number that can move.

| Budget | Measured baseline | Target (PROPOSED) | Owner | Verification command | Status |
|---|---|---|---|---|---|
| Frontend total client JS | 848.6 KB gzipped over 28 chunks | **no regression: ≤865.6 KB (baseline +2%)** | explorer | `.next/static/chunks`, gzipped | PASS (holds by construction) |
| Lazy ELK worker chunk | 422.8 KB gzipped, 1,416 KB raw | **no regression: ≤431.3 KB (baseline +2%)** | explorer | same | PASS (holds by construction) |
| Per-route initial-load JS | **not measured**: Next 16 dropped First Load JS from its build output | to be set from the bundle analyzer, before `FINAL-VERIFICATION` | explorer | `@next/bundle-analyzer` | **DISCOVERY** |
| Frontend test suite wall time | 32.7 s median of 3 runs (33.28, 32.68, 32.56), 468 tests | **≤20 s** | explorer | `pnpm vitest run` in `frontend-new/app` | **FAIL** |
| Frontend test environment time | 19.3 s of 32.7 s | **≤8 s absolute** | explorer | same, the `environment` figure | **FAIL** |
| Backend test suite wall time | 96.6 to 127.1 s over 3 runs, a 31% spread | **DEFERRED**: separate median and p90 targets, set after ≥10 same-machine runs | explorer | `pnpm vitest run` in `backend` | PENDING APPROVAL |
| Backend test suite flakiness | one unexplained serial failure, cause unknown | 0 failures in 50 consecutive runs | explorer | `CI-ISOLATION` | INSUFFICIENT |
| Dead weight retirement | 47 tracked files under `frontend/`, none decided | **every** dead or legacy artifact carries an explicit decision: retire, archive, or keep with a stated reason. Zero undecided | explorer | inventory in `LEGACY-RETIREMENT`, one row per artifact | **FAIL** |
| Duplication | 0.90%: 15 clones, 265 lines over 203 files, at 12 lines / 50 tokens | **≤1.0%** at 12 lines / 50 tokens | explorer | `jscpd --min-lines 12 --min-tokens 50` | **PASS** |
| Change complexity | top-10 churn peaks at 524 lines (`indexer/sync.ts`), then 418 (`indexer/koios.ts`); largest source 637 (`decode/transaction.ts`), largest tracked 871 (an e2e spec) | the 10 highest-churn files each under 400 lines; no file over 800 lines without a stated reason | explorer | `git log --numstat` churn crossed with line counts | **FAIL** |
| Fixture representativeness | not measurable until the fixture pipeline exists | every fixture response validates against its contract, and the set covers every route the demo server serves plus the empty, truncated and error cases | explorer | fixture build, which fails on a contract violation | UNMEASURABLE |

**Dead weight, duplication and change complexity are gates, not observations.** A retirement decision may be "keep it", but there is no such thing as an artifact with no decision. That is the whole failure mode: an undecided artifact reads as a pass because nobody wrote down that it fails.

## Hardware

Ruled 2026-09-04. Every result carries a `hardware` stamp.

| Profile | Meaning |
|---|---|
| `existing-minimum-2-core` | The **accepted minimum supported runtime profile**. `docs/resource-requirements.md:47` states two cores are enough for `demo` and `existing`, and every measurement there was taken on two. Runtime latency, database work, payload and concurrency-32 budgets may be judged here: scheduler pressure is part of performance on the supported minimum |
| `unclassified` | Anything larger. Not yet characterised |

**Two limits on reading these results.** A figure stamped `existing-minimum-2-core` is a measurement on the supported minimum, never a statement about universal production hardware, and no document may drop the stamp when quoting it. And the **backend suite wall-time budget may not be judged here at all**: suite time is a property of the developer and CI runner rather than of the runtime, so it needs a quiet standardised machine and stays deferred.

## Lifecycle

Targets were approved on 2026-09-04. Rows move through these states and no other:

| State | Meaning |
|---|---|
| `PENDING BASELINE` | Target approved, no measurement yet. No row is here after the 2026-09-05 baseline |
| `PENDING APPROVAL` | Target **proposed and not approved**. Cannot be cited as a gate. Every codebase-health row is here |
| `DISCOVERY` | No target by decision. Exists to produce one. Cannot pass or fail, and is excluded from the 10/10 criterion **during `BASELINES` only**. Before `FINAL-VERIFICATION` every `DISCOVERY` row must either become an approved budget or be removed as irrelevant with stated evidence. A row cannot stay permanently unmeasured while the register claims 10/10 |
| `INSUFFICIENT` | Measured, but the sample cannot resolve the target. Reports this rather than passing |
| `UNMEASURABLE` | Current data volume cannot exercise the target. Reports this rather than passing |
| `PASS` / `FAIL` | Measured against an approved target |
| `BLOCKED` | Fails on an open dependency with a shipped fallback. **Not `PASS`**: implementation scope can be complete while the product is below 10/10 |

`BASELINES` moves every `PENDING BASELINE` row to `PASS`, `FAIL`, `BLOCKED` or `INSUFFICIENT`. Nothing returns to an approval state; a target change is a new approval, recorded here with its date.
