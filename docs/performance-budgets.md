# Performance budget register

**STATUS: THE BACKEND TARGET BASELINE IS MEASURED.** Every backend latency, database, payload and resource row now carries a verdict from one artifact, [`efc9af69`](performance/baselines/target-efc9af69.json): ten workloads pass and two fail. Rows this run cannot settle say why rather than staying silent: `overview-aggregate` now has a harness (`--with-frontend`) but no run yet, Web Vitals are collected but have no production samples, and the three CI quality rows are `INSUFFICIENT` at n=12, every failure classified, against targets naming 50. Backend suite wall time still awaits a standardised runner. **The `stress` profile has now been measured** ([`stress-5ded259a`](performance/baselines/stress-5ded259a.json), 2026-09-16): three workloads pass, nine fail, `address-history` answers an error for every request, and the harness stamped the report NOT A BASELINE because two workloads carry too few successful samples for a percentile. The codebase-health targets were ruled 2026-09-04: five unchanged, three revised, one deferred.

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

**Nothing is compressed, anywhere.** The origin has no compression middleware and no such dependency, and the edge proxy ships with `gzip` commented out and no directive in `infra/nginx/explorer-api.conf.template`. Asking for `gzip, br` returns exactly the identity bytes on all eleven eligible routes, so `address-history` sends 1.8 MB uncompressed. That is why the aggregate reduction row reads 0.0% against a 40% target, and why the row above it passes vacuously: a response that is never encoded can never be enlarged by encoding. Since `1dc880db` the edge compresses JSON and the harness measures sizes through it; a smoke run at `target` shrank the eligible routes by 84.8%, which is not a baseline.

Two of the twelve fail, and neither on latency: `block-detail` on route statements (10 against 8) and `transactions-list-page-deep` on temp I/O (3,538 KB against 0). **No latency budget fails anywhere.** Commits since this run target both (`0bcc98d5`, `a66273e6`) and compression (`1dc880db`); they were measured on their own branches, and these rows keep this run's figures until a rerun records them.

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
| `overview-aggregate` | not measured | p95 600 ms / p99 1,200 ms, ≤256 KB wire, ≤1 MB identity | `generated` | target | cold | explorer | none | `pnpm bench --only overview-aggregate --mode smoke --with-frontend` | not yet measured: `--with-frontend` builds and starts the production frontend, and no run has used it yet | One backend aggregate route |
| `blocks-list-saturation` | p50 659.8 / p95 719.0 / p99 741.6 ms, 48.5 req/s, 0.00% errors, 0.00% timeouts, 2.00 route statements (+3.00 control, +0.00 metadata), 9.1 KB wire, 9.1 KB identity | p95 1,500 ms / p99 3,000 ms at concurrency 32, **≥20 req/s**, timeouts ≤0.1%, errors ≤1% | `generated` | target | cold | explorer | UR-1 | `pnpm bench --only blocks-list-saturation --mode smoke` | PASS [`efc9af69`](performance/baselines/target-efc9af69.json) | Raise pool `max`, or shed load at the edge |

### The block-detail fallback, corrected

The dominant payload is **not** `header_cbor` at 361 bytes. `routes/block.ts:103-115` decodes **every** transaction in the block into a full `TransactionView` with inputs, outputs, datums, scripts and redeemers, and the member query at `db/block.ts:38` has **no `LIMIT`**. At the `target` profile's long tail of up to 60 transactions per block, that is what will breach the budget.

Fallbacks in order: paginate or cap the decoded transaction rows and report the cap; then return summaries rather than full views in the block context, with the full view on the transaction route; then move `header_cbor` and `base_tail_datum_cbor` to an opt-in route. The last one alone cannot rescue this budget.

`address-history` draws the **1,000 busiest distinct addresses**, each requested once, equally weighted. That is the population the budget is about: a uniformly drawn address has a single entry and its page measures nothing, so the row would pass on addresses nobody looks up. With one request per address the p95 describes roughly the slowest 50 of those thousand and the p99 roughly the slowest 10. It is deliberately not a cold worst-case: repeating only the busiest 50 would measure a different thing, and if that is wanted later it belongs in its own row rather than silently inside this one.

`address-history` deliberately carries no dependency: it sorts on `time_stamp_tz`, which **is** indexed upstream on `immutable`, `mempool` and `processed_mempool`. If it fails, the missing `block_end_time` index is not the diagnosis.

## Stress profile: what 50,000 blocks does to this

**Measured 2026-09-16 from one artifact, [`stress-5ded259a`](performance/baselines/stress-5ded259a.json): three workloads pass and nine fail.** The harness stamped the report **NOT A BASELINE**, because two workloads returned too few successful responses to carry a percentile. That stamp is the honest verdict on the run, and the failures below are still evidence: a route that answers 500 for every request has been measured, not missed.

**What this run is.** The `stress` profile, 50,000 blocks and 6,834,440 rows in 3.2 GB, against the same approved targets as `target`, on the same two-core machine, with 1,000 requests per workload. It was built from `5ded259a`, which **predates** two committed fixes: `0bcc98d5` (block page statements) and `a66273e6` (transaction page key sort). The `block-detail` statement count and the transaction page's temp I/O below are therefore the pre-fix figures. The machine suspended twice during the run, for 5 minutes and 15 minutes, which inflates some individual samples and cannot produce an error rate.

| Workload | Measured at `stress` | Same workload at `target` | Status |
|---|---|---|---|
| `blocks-list-page-1` | p50 937.9 / p95 1019.0 / p99 1075.9 ms, 2.01 route statements, 235,665.0 KB temp, 9.1 KB wire | p95 40.2 ms, 0 KB temp | FAIL: p95, p99 and temp bytes |
| `blocks-list-page-deep` | p50 1033.8 / p95 1161.3 / p99 1246.2 ms, 2.01 route statements, 235,691.9 KB temp | p95 40.5 ms, 0 KB temp | FAIL: p95, p99 and temp bytes |
| `transactions-list-page-1` | p50 525.1 / p95 562.7 / p99 605.0 ms, 2.00 route statements, 9,507.1 KB temp, 74.0 KB wire | p95 65.2 ms | FAIL: p95, p99 and temp bytes |
| `transactions-list-page-deep` | p50 714.2 / p95 1016.3 / p99 1226.3 ms, 2.01 route statements, 142,974.1 KB temp | p95 75.0 ms, 3,538.2 KB temp | FAIL: p95, p99 and temp bytes. Pre-`a66273e6` |
| `block-detail` | p50 168.3 / p95 191.8 / p99 272.1 ms, 10.04 route statements, 6.8 KB wire, 17.4 KB identity | p95 33.7 ms, 10.01 statements | FAIL: statements only, and inside every latency budget. Pre-`0bcc98d5` |
| `transaction-detail` | p50 80.9 / p95 88.6 / p99 103.7 ms, 7.02 route statements, 4.8 KB wire | p95 20.2 ms | PASS |
| `search-prefix` | p50 212.1 / p95 234.4 / p99 254.9 ms, 6.00 route statements, 66,765 shared blocks | p95 24.9 ms, 5,384 shared blocks | PASS |
| `metrics` | p50 705.3 / p95 746.7 / p99 805.7 ms, 9.01 route statements, 185,544.0 KB temp | p95 66.4 ms, 14,920.0 KB temp | FAIL: p95 and statements |
| `metrics-cached` | p50 0.5 / p95 0.8 / p99 1.8 ms, 0.00 route statements | p95 0.8 ms | PASS |
| `asset-roster` | p50 669.2 / p95 726.9 / p99 798.5 ms, 2.01 route statements, 192,281.7 KB temp | p95 247.1 ms, 14,400.0 KB temp | FAIL: statements only, and inside every latency budget |
| `address-history` | **0 of 1,000 requests succeeded.** 8.6 s of database time and 6,502,806.6 KB of temp files per request, 309,819 shared blocks | p95 236.7 ms, 96,700.7 KB temp | FAIL: 100% error rate |
| `blocks-list-saturation` | **9 of 1,000 requests succeeded.** p50 6226.4 / p95 6795.9 ms, 12.0 req/s, 99.10% errors | 48.5 req/s, 0.00% errors | FAIL: p95, error rate and throughput |

**`address-history` does not slow down at this scale, it stops working.** Each request spends 8.6 seconds in the database and writes 6.2 GB of temporary files, which passes `DB_STATEMENT_TIMEOUT_MS` (10,000), so the route answers an error and the page shows nothing. The note above says that if this row fails, the missing `block_end_time` index is not the diagnosis. That still holds: the cost here is the sort and the spill over a 1.29 million row history, not that ordering column.

**Concurrency collapses before latency does.** At concurrency 32 the blocks list served 9 requests of 1,000 and failed the rest, at 12.0 requests per second against a floor of 20. At `target` the same workload served every request at 48.5 per second.

**What passes says something too.** The three passing rows are the ones that read one keyed record (`transaction-detail`), a prefix index (`search-prefix`), or the cache (`metrics-cached`). Every row that scans and sorts a whole table fails. Peak resident memory was **517.2 MB** at this scale against 737.3 MB at `target`, so memory is not the limit here.

**Named fallbacks, unchanged by this run.** Cursor pagination with a depth cap for the list rows, an upstream index for the ordering (UR-1), and for `address-history` a bounded page over one source rather than a sorted union of three. This run does not choose between them. It says the choice is no longer optional at ten times the current scale.

## Resource, delivery and payload budgets

**The 512 MB memory target has no recorded basis.** It entered in `07f51103`
with its baseline column reading "not measured" and its status "PENDING
BASELINE", so the number was chosen before anything was measured, and no page
here says why 512 rather than another figure. Every other row on this table
cites its source. The same number is the memory limit `docker-compose.yml`
declares for the retained `explorer-postgres` container, which is a different
process, so the coincidence is not a derivation. It may have been meant as a
small-deployment budget; nothing records that, and saying so would be a guess.

**It is kept as the historical target until a replacement is decided**, and it
is not treated as a proven requirement. The question this row should answer is
whether the backend runs reliably inside the resources of a deployment we
intend to support, not whether the number can be forced below 512. A
defensible replacement needs four inputs, and none of them is in this
repository yet:

| Input | What it has to say |
|---|---|
| Deployment capacity | RAM left for the backend after PostgreSQL, the frontend and everything else on the host or tier |
| Expected workload | dataset size, concurrency and sustained request rate the deployment has to carry |
| Headroom | what is left for bursts without swapping or being killed |
| Measurement scope | backend **process-tree resident memory**, which is what the harness samples, not the JavaScript heap |

The order is: measure the updated backend at the agreed workload, then set the
target against the machine or hosting tier somebody has decided to support,
then record that decision here. Until then this row reads FAIL against a
number nobody can source, and that is the honest reading rather than a defect
report.

**No current figure exists for the target profile.** The last measurement,
669.4 MB, was taken at `44ad31ad` on 2026-09-18, which is before the import
narrowing in `688fad3d`. That change moved the idle floor 270.1 to 221.5 MB
and the `small`-profile peak 384.8 to 369.8 MB, so the target-profile number
has certainly moved and nobody knows where to. The series so far, all
historical: 737.3 MB (2026-09-05), 669.4 MB (2026-09-18). Neither met the
target. Restating this row needs the certified rerun, which is blocked below.

**The 2026-09-18 figure is a measurement, not a certified baseline.** The
harness stamped that run `NOT A BASELINE` and exited 2 for two reasons it
records in the artifact: the machine had 27.5 GiB free against the 30 GiB the
gate requires, and `track_io_timing` was off. A third difference is not in the
artifact's warnings and matters more for comparison: that run used a different
PostgreSQL server from every certified baseline above it. It reports version
17.10, `shared_buffers` 160 MB and `effective_cache_size` 5 GB, where
`efc9af69`, `7b1731d5` and the stress run all used the dedicated benchmark
server at 17.11, `shared_buffers` 320 MB, `effective_cache_size` 1.25 GB and
`track_io_timing` on. Half the buffer pool and a planner told the operating
system cache was four times larger do not produce comparable latencies. Read
the 669.4 MB as a resident-memory observation at that head and read none of
that run's latencies against the rows above.

**What dominates the peak is now measured** (`backend/bench/memory.mts`,
2026-09-19). The idle floor, before the server answers anything, was 270.1 MB.
A bare Node process on this machine is 43.8 MB; `@lucid-evolution/lucid` costs
140.9 MB to import and `@al-ft/midgard-core`, which depends on that same
barrel and loads on the first transaction decode, costs 171.7 MB on its own.
Narrowing the explorer's three import sites to `plutus`, `utils` and
`core-types` took the floor to 221.5 MB. The peak fell only 384.8 to 369.8 MB
at the `small` profile, because the codec pulls the barrel back in as soon as
anything is decoded. Above that floor the growth is per-request heap that V8
commits and does not return: `LazyFree` in `/proc/<pid>/smaps_rollup` is 0, so
those pages are genuinely dirty rather than released and uncollected.

Two honest ways to close the row, and neither is raising the number quietly:
get the codec off the barrel, or restate the target against a deployment
constraint somebody can name. The first is an upstream change and a small one.
Every runtime import `@al-ft/midgard-core` makes from `@lucid-evolution/lucid`
is `CML`, at three sites in two chunks, and CML is its own package. Taking it
from `@anastasia-labs/cardano-multiplatform-lib-nodejs` instead would stop the
barrel loading the providers, the wallet and the message-signing bindings, and
the explorer already holds `plutus` and `utils` for its own use: about 44 MB,
the difference between the barrel at 140.9 MB and those two at 96.5 MB. Until one of those happens this row reads FAIL against an
aspiration.


| Budget | Measured baseline | Target (approved) | Owner | Dependency | Verification command | Status |
|---|---|---|---|---|---|---|
| Backend peak RSS, `target` profile | **No current figure.** Historical: 669.4 MB [`44ad31ad`](performance/baselines/target-44ad31ad.json), 2026-09-18, scope `full`, 13 of 13 workloads passing, **stamped NOT A BASELINE**, exit 2, and taken before the import narrowing in `688fad3d` | ≤512 MB, **no recorded derivation**, kept as the historical target until a replacement is decided: see below | explorer | none | `pnpm bench --profile target --mode baseline --with-frontend` (`peakRssBytes`) | **UNVERIFIED** at this head. The last historical figure exceeded the target |
| Frontend `next build` peak | between 1,024 and 1,536 MB (`docs/resource-requirements.md`, measured on this two-core machine) | ≤1,536 MB | explorer | none | `frontend-new/app/scripts/measure.mjs` | PASS at the boundary: the upper bound equals the target, so any growth breaches it |
| Frontend `next dev` floor | between 768 and 896 MB (same source) | ≤896 MB | explorer | none | same | PASS at the boundary: as above |
| Compression never enlarges an eligible response | **0 of 11** responses over 1 KB grew when encoded (vacuous: no response is encoded at all, so none can grow) [`efc9af69`](performance/baselines/target-efc9af69.json) | encoded ≤ identity for every response over 1 KB, measured as identity vs encoded bytes | explorer | none | harness, `encodedBytes` vs `uncompressedBytes` on one url, both taken through the edge proxy named in the report's `payload` | PASS (vacuous, see below) |
| Aggregate compression reduction | **0.0%** over 11 eligible routes (2023.7 KB identity to 2023.7 KB encoded) [`efc9af69`](performance/baselines/target-efc9af69.json) | ≥40% across the JSON route set, weighted by traffic | explorer | none | harness, summed over the workload set, through the edge proxy | FAIL |
| Per-route wire size | `blocks-list-page-1` 9.1 KB, `blocks-list-page-deep` 9.1 KB, `transactions-list-page-1` 66.7 KB, `transactions-list-page-deep` 48.8 KB, `block-detail` 7.3 KB, `transaction-detail` 5.0 KB, `search-prefix` 0.1 KB, `metrics` 3.1 KB, `metrics-cached` 3.1 KB, `asset-roster` 18.4 KB, `address-history` 85.5 KB, `blocks-list-saturation` 9.1 KB [`efc9af69`](performance/baselines/target-efc9af69.json) | the `maxWireBytes` column above | explorer | none | harness | PASS: no row breached its wire budget |
| Index-pass duration | not measured | none | explorer | none | no command yet: this row exists to produce one | **DISCOVERY** |
| Index throughput, L1 txs per minute | not measured | none | explorer | none | same | **DISCOVERY** |
| Web Vitals, production | collected through `POST /api/vitals` into the `explorer_web_vitals_*` histograms; no production deployment has reported a sample yet | **p75** LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1; per route class (list / detail / overview) and device class (mobile / desktop); rolling **28-day** window; **≥1,000 samples per route-and-device cell**, otherwise the cell reports INSUFFICIENT rather than passing | explorer | `TELEMETRY` | the share-inside-budget query in [`production-data-path.md`](production-data-path.md#metrics) | INSUFFICIENT: 0 samples against 1,000 per cell |

The two frontend memory rows are the only ones carrying a real measured baseline. It predates this register and comes from `docs/resource-requirements.md`, not from the harness.

## CI budgets

Four separate measures. A blended failure rate hides which is which, and **a gate correctly rejecting broken code is not inefficiency**.

**Sample size.** A ≤2% rate cannot be resolved by 20 observations: zero failures in 20 runs is consistent with a true rate near 10%. Minimum **50 runs**, rolling **100** preferred. Until the window reaches 50, these rows report INSUFFICIENT rather than passing.

| Budget | Measured baseline | Target (approved) | Owner | Verification command | Status |
|---|---|---|---|---|---|
| Median wall time | **10.68 min** over all 12 hosted runs (3.7 to 14.3), 2026-08-28 to 2026-09-03 | ≤8 min | explorer | `gh run list --limit 100 --json createdAt,updatedAt` | FAIL |
| Infrastructure flake rate | **0 of 12** runs failed on infrastructure; all 15 failed jobs classified below | ≤2% over ≥50 runs | explorer | classification table below | INSUFFICIENT: n=12 against a target that names ≥50 runs |
| Rerun disagreement rate | no run was repeated on the same commit, so there is nothing to disagree | ≤2% over ≥50 runs | explorer | rerun each failure in the window | INSUFFICIENT: 0 reruns |
| First-pass PR rate | no pull request has merged (#2 and #3 are open) | ≥70% over ≥50 PRs | explorer | `gh pr list --state merged --limit 100` | INSUFFICIENT: 0 merged PRs |

**Every failure in the window, classified.** 9 of 12 runs failed, on 15 jobs. Each class is settled by the commit that made the job pass, not by the log message: several logs carry incidental noise (`Koios fetch failed`, `Can't reach database`) that was not the cause.

| Class | Jobs | Failures | Fixed by |
|---|---:|---|---|
| Gate working as intended | 6 | two unrecorded advisories (`mysql2`; `qs` and `fast-uri`); six unused imports in the frontend; `Ctrl-C` left the API answering; the seed listed transactions it did not claim; `pnpm dev` waited for Docker to accept rather than for Postgres to be healthy | `80adccff`, `8732cf45`, `e6f934d6`, `6d98bf69`, `03027993`, `a36d6813` |
| CI-only configuration | 5 | a doctor step asserted a mode that is not built; the `pnpm dev` job had no `backend/.env`; the contract gate had no database password; a third copy of the package checks ran without a database; an assertion checked a restart rule the adoption record does not keep | `4aac146b` (two), `76dea831`, `63a57135`, `07aa1c6a` |
| Nondeterministic test | 2 | database suites shared one database under file parallelism; a width was measured before hydration settled | `cf111e73`, `26a224fe` |
| Not attributable | 2 | two readiness steps of the removed development script's `up existing` mode, which was replaced whole rather than fixed | `6d98bf69` |
| Infrastructure | 0 | none | |

The nondeterministic class is the one the flake budget exists for, and it is not infrastructure: both were defects in tests that passed locally by timing. The database race has not recurred in the ten runs after its fix, and the hydration fix has run once, as its own commit. Neither count is enough to call them gone.

## Codebase health budgets

The five dimensions of the original assessment that no latency, resource or CI row measures. Without these the register could read all-`PASS` while dead weight, duplication and change cost sit where they are today.

**Ruled 2026-09-04.** Five approved unchanged, three revised, one deferred. The deferred row, backend suite wall time, still waits for ten same-machine runs.

**Why the bundle rows are ratchets, not limits.** The 422.8 KB chunk is the lazily instantiated ELK layout worker (`UtxoFlowCanvas.tsx:118`, behind `needsElk` and a `typeof Worker` guard), so it is not initial-load JS and a 250 KB cap on it would gate the wrong thing. Verified: the chunk contains 352 `elk` references and no route imports it eagerly. A no-regression ratchet holds the line until the analyzer can give real per-route initial-load figures, which is the `DISCOVERY` row below.

**Why environment time replaced the overhead ratio.** A ratio of overhead to total is gameable in the wrong direction: adding slow assertions improves it while making the suite worse. An absolute environment-time target cannot be satisfied that way.

**Why duplication tightened to 1.0%.** ≤1.5% against a 0.90% baseline would licence a 67% regression and still read green.

**Baselines measured 2026-09-04**, so the targets are now set against observation rather than invented. Two corrections came out of measuring:

- **The 82-second frontend suite figure was stale.** Three runs give 32.7 s median with a 0.7 s spread. The overhead *share* is the real problem and did not improve: 19.3 s of environment against 3.8 s of execution.
- **The original duplication target passed trivially.** At 40 lines the codebase has zero clones, so the gate would have measured nothing. Measured at 12 lines it is 0.90%, which is a number that can move.

| Budget | Measured baseline | Target (approved) | Owner | Verification command | Status |
|---|---|---|---|---|---|
| Frontend total client JS | 848.6 KB gzipped over 28 chunks | **no regression: ≤865.6 KB (baseline +2%)** | explorer | `.next/static/chunks`, gzipped | PASS (holds by construction) |
| Lazy ELK worker chunk | 422.8 KB gzipped, 1,416 KB raw | **no regression: ≤431.3 KB (baseline +2%)** | explorer | same | PASS (holds by construction) |
| Per-route initial-load JS | **not measured**: Next 16 dropped First Load JS from its build output | to be set from the bundle analyzer, before `FINAL-VERIFICATION` | explorer | `@next/bundle-analyzer` | **DISCOVERY** |
| Frontend test suite wall time | 32.7 s median of 3 runs (33.28, 32.68, 32.56), 468 tests. **2026-09-15, `node` by default:** 14.35 s median of 3 (14.33, 14.83, 14.35), against 25.24 s (25.17, 25.24, 25.34) for `jsdom` everywhere, alternated in one session | **≤20 s** | explorer | `pnpm vitest run` in `frontend-new/app` | PASS |
| Frontend test environment time | 19.3 s of 32.7 s. **2026-09-15:** 4.63 s median of 3 (4.58, 4.73, 4.63), against 15.35 s for `jsdom` everywhere | **≤8 s absolute** | explorer | same, the `environment` figure | PASS |
| Backend test suite wall time | 96.6 to 127.1 s over 3 runs, a 31% spread | **DEFERRED**: separate median and p90 targets, set after ≥10 same-machine runs | explorer | `pnpm vitest run` in `backend` | PENDING APPROVAL |
| Backend test suite flakiness | one unexplained serial failure, cause unknown | 0 failures in 50 consecutive runs | explorer | `CI-ISOLATION` | INSUFFICIENT |
| Dead weight retirement | 3 artifacts, all decided 2026-09-15 (inventory below) | **every** dead or legacy artifact carries an explicit decision: retire, archive, or keep with a stated reason. Zero undecided | explorer | inventory below, one row per artifact | PASS |
| Duplication | 0.90%: 15 clones, 265 lines over 203 files, at 12 lines / 50 tokens | **≤1.0%** at 12 lines / 50 tokens | explorer | `jscpd --min-lines 12 --min-tokens 50` | **PASS** |
| Change complexity | top-10 churn peaks at 524 lines (`indexer/sync.ts`), then 418 (`indexer/koios.ts`); largest source 637 (`decode/transaction.ts`), largest tracked 871 (an e2e spec) | the 10 highest-churn files each under 400 lines; no file over 800 lines without a stated reason | explorer | `git log --numstat` churn crossed with line counts | **FAIL** |

**Dead and legacy artifacts, inventoried 2026-09-15.** Tracked files only: gitignored local prototypes under `frontend/` are not repository artifacts.

| Artifact | Size | Decision | Reason |
|---|---|---|---|
| `frontend/`, the previous Vite client | 47 files, 6,304 lines | keep, frozen | Owner ruling 2026-08-25, confirmed 2026-09-15: the previous client, no longer developed, and no CI job builds it |
| `getBlockHeader` in `backend/src/db/block.ts` | one wrapper | keep | No production caller since `0bcc98d5`; the block query tests read a header through it |
| `getBlockDaMetadata` in `backend/src/db/block.ts` | one keyed query | keep | No production caller since `0bcc98d5`; it is the independent query the merged block read is checked against |
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
