# Codebase efficiency and implementation progress review

- **Review date:** 2026-09-02
- **Branch baseline:** `wip/dev-onboarding` at `63a57135`
- **Review target:** the uncommitted cross-layer identity, source, consistency,
  snapshot, API, and frontend work then in progress
- **Purpose:** provide a strict planning input, not approve a production rollout

## Executive decision

The architectural direction is sound: canonical Midgard header identity, an explorer-owned Cardano index, direct or replicated read-only access to the Midgard database, real-data snapshots for offline development, repeatable-read response aggregates, and fixtures reserved for deterministic tests are the simplest coherent design for this repository.

The current implementation is **not yet production-ready**. It contains substantial improvements, but it is not “only improvements.” Four release-blocking correctness or safety issues remain:

1. Snapshot restore can clean an existing database that the tool did not create, and untrusted sidecar values are interpolated into SQL.
2. The canonical-header migration is not scoped to the configured state-queue policy and its cursor-reset condition is evaluated after the rows that should trigger it have been deleted.
3. The deployment-binding readiness probe writes state and can let the first manifest silently claim a populated, unbound index.
4. L1 freshness currently reports zero lag for every built index, so a stopped index can be treated as fresh and a lagging disagreement can become a false mismatch.

The fastest safe route is to keep the chosen architecture, stop adding breadth temporarily, correct those blockers, make the acceptance tests non-vacuous, and then finish the partially applied consistency boundary. Broad cleanup and file splitting should follow behavior stabilization rather than share commits with the migration or restore tooling.

## Scope and method

This review covered the active backend, active frontend, contracts, UI package, tests, scripts, infrastructure, CI workflow, and the retained legacy frontend. It included:

- inspection of the current tracked and untracked diff;
- direct review of migration, binding, readiness, source classification, reconciliation, snapshot, ingestion, decoding, API, contract, and frontend code;
- repository-wide file and line counts;
- targeted tests for cross-source identity, migration backfill, deployment binding, repeatable reads, reconciliation, and out-reference batching;
- backend and frontend type checks, backend documentation validation, frontend lint, and frontend formatting validation;
- comparison of current code against the implementation status previously reported.

This is a moving uncommitted worktree. Findings below describe the reviewed snapshot and should be rechecked before commits are cut. No production database was mutated and no rollout was performed as part of this review.

## What the new direction gives the application

If completed with the safeguards in this report, the direction provides:

- correct 28-byte Midgard block identity throughout the explorer;
- working block-to-Cardano and Cardano-to-block navigation;
- explicit evidence from both the Midgard node and the explorer’s Cardano index;
- honest `matched`, `stale`, `unavailable`, and mismatch states rather than silent source preference;
- an L2-only readiness boundary, so L1 index lag does not remove the whole explorer from service;
- production reads from a read-only Midgard primary or streaming replica without duplicating the node’s mutable database into an application projection;
- real, fixed-time snapshot data for development without starting Midgard;
- deterministic fixtures only where determinism is the objective;
- internally consistent multi-query responses from one L2 database snapshot;
- materially fewer database round trips during L1 ingestion and transaction decoding.

This supports running the explorer backend without starting a local Midgard node **only when it can reach one of the supported L2 data sources**: a primary, a deployed streaming replica, or a restored real-data snapshot. The explorer cannot invent or incrementally refresh L2 data while every Midgard source is absent. When Midgard is running, PostgreSQL streaming replication—not application polling—is the preferred production synchronization mechanism.

## Strict review of claimed accomplishments

The earlier lane report is now stale in both directions. It understates work that has since landed, but overstates completion of several components whose happy path exists while their safety or acceptance criteria do not.

| Task | Earlier claim | Current assessment | Required disposition |
| --- | --- | --- | --- |
| T1 — ADR 0006 | Done | Implemented, not final | Correct migration policy scope, freshness semantics, binding adoption, and mismatch preconditions. |
| T2 — association contracts and `Hash28` | Done | Largely implemented | Use the specific block/transaction association schemas on their endpoints instead of the broad five-kind union. |
| T3 — MBLC extraction, ingestion, fixture repair | Done and mutation-verified | Happy path verified | Add foreign-policy rejection and fail-closed I/O-to-asset mapping invariants. |
| T4 — migration, binding, constraints | Done, rehearsed 9/9 | **Not production-complete** | The live-clone result proves the nine current rows, not generic migration correctness. Fix policy filtering, cursor reset, and explicit adoption. Live data remains untouched. |
| T5 — coverage cursors | Done | Partial | Equal heights are recorded, but elapsed freshness is discarded and then reported as zero. Preserve cursor observation time or sampled-tip time. |
| T6 — readiness split, scopes, proxy | Done | Mostly implemented | Keep `/readyz` L2-only and `/readyz/l1` index-specific, but make binding checks read-only and make CI call every advertised readiness scope. |
| T7 — repeatable-read aggregates | Previously not started | Partially implemented | Block and several page/count pairs use one snapshot. Transaction, address, asset, metrics, and any other multi-query response still need disposition. |
| T8 — resolver | Previously not started | Implemented but semantically incomplete | Do not return an actionable hash for stale disagreement; align `unavailable` behavior and unknown-freshness behavior. |
| T9 — API envelopes | Previously not started | Partially implemented | Block and transaction carry context/association, and the block page’s second L1 request has been removed. Narrow endpoint contract types and complete snapshot scope. |
| T10 — frontend | Previously not started | Partially implemented | Association panel and search changes exist. Correct relationship-specific wording and clear the formatting gate. |
| T11 — L2 transaction work | Previously not started | Partially implemented | Settlement exists, but finalization/lifecycle reads remain outside the transaction snapshot. Batching is now corrected and its targeted test passes. |
| T12 — fixtures and CI | Previously not started | Partially implemented | Tests were added, but CI does not yet seed aligned non-empty node/index data for every acceptance test. |
| T15 — snapshot tooling | Previously not started | Draft implemented, **not releasable** | Fix destructive targeting, SQL interpolation, metadata validation, capture semantics, and snapshot source-time reporting. |

The correct status language is therefore:

- **implemented** means code exists;
- **verified** means a meaningful automated or live-clone test exercised it;
- **production-proven** means it has been deployed and observed under the intended environment.

No current lane should yet be described as fully production-proven. In particular, the replica is provisioned and documented but not deployed here, and the many-to-one settlement case still lacks live traffic.

## Release-blocking findings

### P0 — Snapshot restore ownership and SQL safety

`backend/scripts/snapshot.mjs` says the restore target is a database the script creates. The code does not create it. It accepts `SNAPSHOT_TARGET_URL`, refuses only a database named exactly `midgard`, and invokes `pg_restore --clean --if-exists --single-transaction` against the selected database.

Consequences:

- an existing development, test, staging, or production database with any other name can be cleaned;
- the safety claim in the comment and documentation is materially stronger than the implementation;
- sidecar JSON fields are interpolated into SQL string literals used to create `explorer_snapshot_meta`;
- the target database name is interpolated as an SQL identifier;
- only the archive checksum is verified, while sidecar shape and values are trusted.

Required fix:

1. Prefer an admin connection from which the tool creates a uniquely named target database itself.
2. Otherwise require an empty target carrying a tool-owned marker; restoring over an existing nonempty database must be refused by default.
3. If destructive overwrite is ever supported, require a separate explicit flag plus an exact target confirmation. Do not infer safety from the database name.
4. Validate the metadata with a strict runtime schema, including kind, version, timestamps, hashes, row counts, network, archive basename, and deployment identifier.
5. Pass values through `psql` variables or another parameterized mechanism; validate and quote identifiers independently.
6. Bind the metadata checksum to the archive, or package both in one authenticated manifest. At minimum, checksum the canonical metadata as well as the dump.
7. Review and document whether operational admissions, rejections, addresses, and raw payloads may be distributed in developer snapshots.

The export documentation also overstates the consistency difference between primary and standby dumps. PostgreSQL `pg_dump` already takes a consistent MVCC snapshot across a dump; `--serializable-deferrable` changes safe-snapshot waiting/conflict behavior, not whether ordinary `pg_dump` uses one cross-table snapshot. The ADR and script comments should be corrected before operators make source-selection decisions from them.

### P0 — Canonical-header migration is deployment-ambiguous

The backfill in `20260902190000_canonical_header_and_binding/migration.sql` selects a positive asset whose name begins with `MBLC`, but it does not restrict `policy_id` to the configured state-queue minting policy.

A settlement transaction containing another policy’s MBLC-prefixed asset can therefore become ambiguous or supply the wrong candidate. The 9/9 live-clone rehearsal proves the current nine transactions; it does not prove the migration for every valid or adversarial transaction.

Required fix:

- scope the backfill to the verified deployment’s state-queue policy;
- make deployment-specific policy input an explicit migration/preflight artifact rather than a hidden runtime assumption;
- test a same-transaction foreign-policy MBLC asset;
- retain the width and uniqueness constraints as the fail-closed boundary.

### P0 — Migration cursor reset is evaluated too late

The migration deletes headers that remain non-56-hex, then resets cursors only when a remaining header has `l1_tx_hash IS NULL`. The deleted rows cannot satisfy the later `EXISTS` condition.

If any carried-forward or unattributed row is deleted, the migration can leave cursors advanced and never rebuild that missing row.

Required fix:

- capture whether invalid rows existed before deletion in a CTE, temporary table, or explicit preflight value;
- reset all related coverage cursors based on that captured fact;
- execute the complete migration in an automated test, not only the `WITH minted ... UPDATE` fragment;
- assert update count, delete count, cursor outcome, constraints, and rollback behavior.

### P0 — Deployment binding is claimed by a readiness GET

`probeDeploymentBinding()` calls `bindOrCheck()`, and `bindOrCheck()` inserts a binding when none exists. This makes readiness state-changing and lets the first process configuration claim a populated legacy index without proving its rows belong to that manifest.

Required fix:

- make every readiness probe read-only;
- bind a fresh empty index during an explicit startup/bootstrap transaction;
- require an explicit adoption command for a populated legacy index;
- before adoption, validate the existing `l1_event.deployment` values and all available live evidence against the intended manifest;
- fail readiness for a nonempty, unbound index;
- change tests that currently treat “claims on first sight” as desired behavior;
- make `getDeploymentContext().identityState` depend on a confirmed binding, or rename the state so it does not claim verification.

### P1 — L1 freshness cannot currently become stale

`getIndexSettlement()` calculates coverage height, then returns `indexLagSeconds: 0` whenever coverage is nonzero. This makes any built index appear current, even if its worker stopped days ago.

It also uses the Midgard block window’s `endTime` as `indexObservedAt`, which is not the time the Cardano index observed or covered the row.

Consequences:

- a genuine lagging difference can be promoted to `mismatch`;
- the UI’s “as of” timestamp describes the L2 block rather than index observation;
- equal cursors are still incorrectly equated with proximity to chain tip.

Required fix:

- retain each sync cursor’s `updated_at`, or persist the sampled Cardano tip height and time for each reconciled pass;
- derive staleness from an observation clock, not height alone;
- use indexed L1 transaction time or cursor observation time for `l1ObservedAsOf`;
- test equal-but-old cursors, partially built indexes, unavailable indexes, and recently reconciled quiet chains.

### P1 — Resolver can produce an unsafe actionable answer

The reconciliation model is a strong improvement, but three branches are inconsistent with its own contract:

- differing hashes with unknown lag become `mismatch`, although freshness was not verified;
- an unavailable index plus a node hash becomes `node_only`, despite comments saying an unreadable source produces `unavailable`;
- `resolvedHash()` nulls only `mismatch`, so a stale disagreement exposes the index hash as the single actionable settlement hash.

Required fix:

- return no resolved/actionable hash for both `mismatch` and stale disagreement;
- choose and document whether source outage is `unavailable` with retained node evidence or a distinct `node_only_unverified` state;
- never emit `mismatch` unless both observations have verified deployment identity and verified comparable freshness;
- add a separate `indeterminate` state if unknown freshness cannot be represented honestly by `stale` or `unavailable`.

## High-priority correctness and gate findings

### Acceptance tests can still pass without exercising the relationship

The earlier report correctly caught and fixed one vacuous cross-source test. The same class remains elsewhere:

- backend CI creates the node schema but does not provide node settlement data aligned with the Cardano commit fixture used by `cross-source-identity.test.mts`;
- frontend backend-contract tests can return early when no L1 header exists, allowing block-association coverage to pass without a block detail response;
- some direct row assertions still return when a row is absent rather than requiring a nonempty fixture;
- the workflow checks `/healthz` and `/readyz`, but does not prove `/readyz/l1` and `/readyz/full` despite advertising the split.

Required fix:

- create one shared cross-source fixture that seeds matching node and index records;
- require nonempty data in every acceptance-class test;
- fail CI when the expected header, settlement, or transaction is absent;
- curl all readiness scopes in the compiled-server job;
- preserve mutation tests that replace the canonical key with `utxosRoot` and verify the intended assertions fail.

### Repeatable-read coverage is incomplete

The new `readConsistently()` helper is directionally correct: repeatable-read, pool-level read-only enforcement, a five-second timeout, and one bounded retry for known transient PostgreSQL errors.

Implemented coverage includes the block aggregate and several row/count paginated queries. Remaining inconsistencies include:

- transaction body/admission/inclusion are read together, but block finalization is fetched afterward;
- a missing transaction’s lifecycle lookup occurs outside the first snapshot;
- address history, address UTxOs, asset rows/counts, and metrics still compose independent statements;
- metrics uses roughly thirteen statements and is a particularly poor candidate to serialize without first consolidating SQL;
- search fans out across sources and needs an explicit consistency decision, even if it is lower risk than a detail response.

Required fix:

1. Keep transaction inclusion, dependent finalization, and lifecycle in the same short node transaction.
2. Wrap all row/count pairs and stateful multi-query details.
3. Consolidate metrics and block SQL before accepting serialized latency.
4. Strengthen tests so they prove snapshot stability across a deliberate time gap and exercise the retryable error surface.
5. Benchmark on the actual standby; local-primary success is not replica validation.

### Ingestion batching needs a fail-closed mapping invariant

Bulk I/O, asset, and redeemer writes are a meaningful efficiency improvement. However, an asset-bearing I/O whose generated ID is absent currently receives `ioId: null`. Null is also the intentional representation for mints, so this silently changes an output asset into a transaction-level asset.

Required fix:

- assert the returned I/O count and the `(kind, position)` map are complete;
- throw if any non-mint asset cannot be attached to its I/O;
- add a mutation test for missing/reordered returned IDs;
- retain mints as the only intentional null-`ioId` asset class.

### Out-reference batching update

The first batching version re-queried every legitimate batch miss and omitted output outrefs, preserving an N+1 path. That defect was corrected during this review:

- inputs, reference inputs, and outputs now enter one requested set;
- a missing key that was requested is treated as an authoritative miss;
- only a key outside the requested set may fall back to a single lookup.

The latest targeted run passed all 52 tests across six relevant files, including the batching test. This item is now **implemented and targeted-test verified**, but still needs a database-backed query-count assertion to prove the SQL adapter’s `ANY(bytea[])` behavior and real round-trip count.

## Source identity and snapshot semantics

### Dynamic freshness is memoized forever

`getSourceIdentity()` memoizes the entire result, including `readL2Source()` freshness. Manifest identity is static for the process, but replica replay lag and observed-as-of time are dynamic. After the first request, source freshness can remain frozen until restart.

Required fix:

- memoize only manifest/deployment metadata;
- read dynamic source state per request or through a short, explicit TTL cache;
- test freshness changing while deployment identity stays constant.

### Snapshot classification uses table existence, not marker contents

`readL2Source()` detects a snapshot from the existence of `explorer_snapshot_meta` and then uses the newest block time. It does not read the marker row’s `captured_at`.

Required fix:

- require exactly one valid marker row;
- report snapshot `observedAsOf` from `captured_at`;
- present snapshot age separately from replica lag, or update the contract comment if `lagSeconds` intentionally excludes snapshot age;
- keep `freshness: fixed` so a snapshot is not accused of failing to advance;
- deprecate `isFixture` after one compatibility release and ensure UI consumers use `sourceKind`.

## Contracts and frontend findings

### Improvements already present

- The block API now returns its Cardano association directly; the frontend no longer performs a second L1 request that could contradict the first response.
- Search no longer constructs an external Cardano link for every arbitrary 64-hex string; it uses the explorer’s internal context path.
- Hash normalization is centralized at request boundaries.
- One association component presents evidence from both sources and preserves both hashes on disagreement.
- Source kind distinguishes primary, replica, snapshot, and fixture.

### Remaining contract and copy issues

- `BlockResponse.cardano` accepts the broad `Association` union; it should accept `BlockSettlement` only.
- Transaction responses should accept `L2TransactionSettlement` only.
- The generic `node_only` copy says the chain index has not covered the transaction yet, but the same verdict can currently mean index outage or can appear on bridge provenance relationships where “settlement” is the wrong claim.
- Relationship-specific labels should distinguish settlement from deposit origin, withdrawal request, and forced-order provenance.
- External Cardano links validate width, not provenance. Callers should only create them from indexed evidence or a branded/provenance-aware type.
- Frontend formatting currently fails in eight files. This is a real gate failure, although type checking and lint pass.

## Repository-wide efficiency and code-size review

### Current size snapshot

These are physical line counts, useful for locating review surface but not for equating size with waste.

| Area | Files/lines reviewed | Files over 300 lines | Lines in >300-line files | Share concentrated in >300-line files |
| --- | ---: | ---: | ---: | ---: |
| Active product code — backend, current frontend, contracts, UI | 29,460 lines | 21 | approximately 9,000 | approximately 31% |
| Operations — backend scripts, infrastructure, CI | 5,916 lines | 7 | approximately 3,500 | approximately 59% |
| Tests, excluding fixture directories | 18,301 lines | 12 | approximately 5,500 | approximately 30% |
| Retained legacy `frontend/src` | 2,895 lines | 2 | 674 | 23% |

The largest active files are:

| File | Lines | Assessment |
| --- | ---: | --- |
| `backend/src/db/l1.ts` | 654 | Mixed responsibilities; split source identity, queries, cursors, and settlement reads after semantics stabilize. |
| `backend/src/decode/transaction.ts` | 637 | Complex codec boundary; some split value is real, but correctness tests matter more than raw size. |
| `backend/src/indexer/koios.ts` | 596 | Transport, validation, batching, and retry policy should be separated. Do not parallelize provider calls without rate-limit telemetry. |
| `backend/src/indexer/manifest.ts` | 552 | Strong consolidation candidate; parser, normalization, deployment ID, and projection can be separated. |
| `backend/src/server/catalogue.ts` | 539 | Mostly declarative endpoint/probe registry; large does not imply runtime inefficiency. |
| `backend/src/indexer/sync.ts` | 514 | State machine plus persistence concerns; split by phase after behavior is pinned. |
| `frontend-new/app/src/lib/journey.ts` | 483 | Repeated construction patterns are a maintainability target. |
| `frontend-new/app/src/features/block/BlockView.tsx` | 448 | Split summary and tabs after association behavior stabilizes. |
| `frontend-new/contracts/src/l1.ts` | 400 | Declarative schemas; size is mostly legitimate. Organize by response family if navigation suffers. |
| `backend/src/db/metrics.ts` | 397 | Runtime hotspot: approximately thirteen SQL statements and no shared snapshot. Consolidation should be measured. |
| `backend/src/db/block.ts` | 387 | Runtime and consistency hotspot; consolidate related reads. |
| `frontend-new/app/src/features/address/AddressView.tsx` | 360 | Split data/state coordination from view sections. |
| `backend/src/db/association.ts` | 343 | Cohesive domain logic, but common evidence construction and per-kind semantics need sharper types. |
| `frontend-new/app/src/components/search/SearchOverlay.tsx` | 331 | Split state/search orchestration from result presentation if further growth continues. |
| `backend/src/indexer/ingest.ts` | 325 | Runtime-sensitive and already improved; preserve transactional cohesion. |

Files over 300 lines are an audit signal, not a defect. Declarative catalogues, schemas, glossaries, and graph/canvas components can be cohesive at that size. Splitting them can increase imports and total lines without reducing runtime work. The first refactors should target files where size coincides with mixed ownership, repeated queries, or repeated construction—not size alone.

### Runtime efficiency hotspots

1. `db/metrics.ts`: consolidate approximately thirteen queries into a small number of thematic statements and benchmark p50/p95.
2. Block detail: preserve one repeatable snapshot while reducing its roughly eight node statements to two to four.
3. Transaction lookup: replace sequential immutable/processed/mempool/journal probes with one priority union where feasible.
4. Address history: rows and summary repeat large CTEs; share a CTE or return a window count.
5. Asset detail: avoid decoding tens of thousands of rows per request without measured demand; pair row/count reads in one snapshot.
6. Ingestion: retain the new bulk-write design and add query-count budgets.
7. Transaction decoding: retain one authoritative outref batch per transaction and prove it with a DB integration counter.

A dedicated explorer projection of the entire Midgard database is not justified by these hotspots. PostgreSQL streaming replication is already the stronger incremental copy mechanism for mutable rows and deletions. A narrow derived read model may be justified later for a measured asset or metrics bottleneck; it should not become a second implementation of Midgard state synchronization.

## Duplication, reuse, and defensible bloat estimates

There is no evidence that a large percentage of this repository is duplicated library functionality. The backend already reuses `@al-ft/midgard-core`; the explorer-specific extraction of canonical identity from indexed state-queue assets is an observation/join concern rather than a general codec replacement.

Confirmed or plausible consolidation targets are:

- a small duplicate byte-to-hex helper in transaction decoding versus `backend/src/utils.ts`;
- manifest normalization, deployment ID, and identity projection overlap that could become a small stable upstream/shared package;
- manually mirrored backend/frontend association wire shapes;
- repeated frontend journey/result construction;
- operational script environment, process, and validation helpers;
- the retained previous Vite frontend.

The backend cannot directly import frontend Effect schemas, and the frontend should not import backend database/domain implementations. If wire-shape drift becomes material, the clean solution is a small pure protocol package or generated contracts, not cross-importing application packages.

### What percentage is bloat?

A precise repository-wide “bloat percentage” is not supportable from line counts. Similar-looking code can enforce different trust boundaries, and splitting or deduplicating small helpers can increase rather than decrease code.

The defensible estimates are:

- **Clear removable legacy product source:** 2,895 lines. Removing `frontend/src` after its rollback window would reduce current-plus-legacy product source by about **9%**, or the broader product/operations/test source reviewed here by about **5%**.
- **Likely safe active-code consolidation beyond legacy:** approximately **1–3%**, mainly shared manifest/protocol utilities and repeated builders. This is an engineering estimate requiring per-change review, not an established deletion target.
- **Large files:** about 31% of active product lines sit in files over 300 lines, but that is concentration, not 31% waste.

The current uncommitted implementation adds thousands of physical lines across production code, tests, fixtures, and documentation. Those additions cannot be labeled bloat as one group. Tests and explicit evidence models intentionally add lines to remove hidden behavior. The right gate is whether each addition owns a distinct invariant and whether runtime query count, response consistency, or user truthfulness improves.

## Efficiency improvement: what can and cannot be stated as a percentage

An application-wide efficiency percentage is not currently measurable. The work changes several different axes:

- correctness and observability improve;
- database round trips fall in ingestion and decoding;
- repeatable-read transactions can increase per-request latency because queries on one connection serialize;
- source checks add small database reads;
- snapshots improve developer startup time but do not accelerate production requests;
- removing legacy code improves maintenance surface, not runtime.

Local operation-level statements are supportable:

- the ingestion refactor changes per-I/O/per-asset inserts into a small fixed set of bulk writes; the documented 80-round-trip example becomes roughly four writes, about a **95% round-trip reduction for that example**, not for the whole app;
- outref resolution changes from one lookup per input/reference/output toward **one batch per decoded transaction**, an asymptotic O(n)-to-O(1) round-trip improvement;
- removing the block page’s second L1 request removes one frontend/backend round trip and eliminates cross-request contradiction.

Before claiming an overall percentage, capture these baselines and budgets:

- SQL statement count per endpoint;
- backend p50, p95, and p99 latency;
- replica replay lag and cancellation rate;
- index sync duration and provider calls per pass;
- frontend request count, transferred bytes, and largest-contentful-paint for key pages;
- developer cold start and snapshot restore time.

## Regressions and tradeoffs in the new direction

The direction is predominantly beneficial, but it introduces or exposes these regressions if landed without guardrails:

| Change | Benefit | Regression/tradeoff | Guardrail |
| --- | --- | --- | --- |
| Correct header key in place | Repairs identity and three dead-link paths | Old writers inserting 64-hex roots will fail | Deploy writer fencing and migration atomically; retain width constraint. |
| Repeatable-read response aggregates | One coherent L2 snapshot | Statements serialize on one connection; standby conflicts may cancel long reads | Consolidate SQL, five-second timeout, bounded retry, benchmark on replica. |
| L1 staleness in readiness | Stops claiming a stale index is current | If placed in global `/readyz`, routine lag becomes a full L2 outage | Keep `/readyz` L2-only and put L1 conditions in `/readyz/l1`/`full`. |
| Deployment binding | Prevents silent cross-deployment merges | Requires explicit adoption/rebuild operations | Read-only probe plus deliberate bootstrap/adoption command. |
| Real-data snapshots | Offline development without Midgard | Destructive restore and data-distribution risk | Tool-owned target, strict metadata, checksums, sanitization/access policy. |
| Association evidence | Honest source disagreement | More states and UI wording to maintain | Central resolver, relationship-specific copy, exhaustive tests. |
| Streaming replica | Complete transactional copy, including updates/deletes | Operational replication/TLS/replay-conflict burden | Authenticated TLS, monitoring, WAL retention, short read-only queries. |

Therefore the answer to “only improvements?” is **no**. The architecture improves correctness and simplicity overall, but the implementation must deliberately contain availability, migration, latency, and snapshot-safety tradeoffs.

## Fastest safe implementation plan

Parallel work is appropriate inside each phase where files and invariants do not overlap. Commit boundaries should remain coherent enough to review and revert. The migration, restore tool, and broad cleanup should never be one commit.

### Phase A — stop-the-line safety and canonical identity

Run these as parallel subtracks, then integrate:

1. Fix migration policy scope, pre-delete cursor reset, complete migration test, old-writer fencing, and rollback rehearsal.
2. Replace readiness auto-binding with explicit empty-index bootstrap and validated legacy adoption.
3. Fix snapshot target ownership, metadata schema/checksums, SQL parameterization, and capture documentation.
4. Add ingestion I/O mapping invariants.

Exit gate: complete migration rehearsal on a fresh database and a live clone; malicious/invalid snapshot metadata rejected; nonempty unbound index fails without mutation.

### Phase B — freshness and reconciliation truthfulness

1. Persist or expose cursor observation time/sampled tip time.
2. Correct `indexObservedAt` and lag calculation.
3. Split static manifest memoization from dynamic source freshness.
4. Correct stale, unavailable, unknown, and resolved-hash semantics.
5. Make identity verification an explicit resolver input.

Exit gate: table-driven resolver tests cover every source-presence, freshness, identity, and equality combination; no actionable hash exists under unresolved disagreement.

### Phase C — response consistency and measured performance

1. Complete transaction finalization/lifecycle snapshot scope.
2. Cover address and asset aggregates.
3. Consolidate metrics and block queries before or with repeatable-read wrapping.
4. Add real query-count tests for ingestion and outref batching.
5. Record endpoint latency and query-count baselines.

Exit gate: every multi-query response has a documented snapshot boundary; p95 stays within an agreed budget; retry behavior is tested.

### Phase D — gate truthfulness, contracts, and UI

1. Seed one aligned, nonempty node/index relationship in CI.
2. Remove early-return success from acceptance tests.
3. Exercise `/readyz`, `/readyz/l1`, and `/readyz/full`.
4. Narrow block and transaction association contracts.
5. Make association copy relationship-specific.
6. Run Prettier and all frontend gates.

Exit gate: the identity mutation makes the cross-source gate fail; every detail contract test proves at least one record; frontend full check is green.

### Phase E — environment proof

1. Deploy the documented streaming replica with authenticated TLS.
2. Run the explorer against it and measure replay lag, read cancellation, and repeatable-read latency.
3. Generate a finalized block containing multiple L2 transactions.
4. Turn the many-to-one acceptance check from fixture-only into a real-data integration check.

Exit gate: replica behavior and the central many-to-one claim are observed in the intended environment.

### Phase F — cleanup after behavior freezes

1. Split mixed-responsibility files without changing behavior.
2. Extract a small shared protocol/manifest package only where ownership is stable.
3. Archive or delete the legacy frontend after the rollback window and update scripts/docs/CI.
4. Remove compatibility fields after a documented release window.

Exit gate: no runtime or contract changes mixed with cleanup; line reduction and dependency changes are measured separately.

## Recommended consolidated commit structure

Six reviewable commits are a practical minimum for the current breadth:

1. **Canonical identity, safe migration, explicit deployment binding, and non-vacuous identity gates**
2. **Coverage clocks, source identity, readiness scopes, and reconciliation semantics**
3. **Repeatable-read aggregates, query consolidation, ingestion/outref batching, and performance assertions**
4. **Typed association API, frontend evidence UI, and search behavior**
5. **Safe snapshot workflow, source labeling, operational documentation, and CI checks**
6. **Behavior-neutral code organization and legacy frontend removal**

If the ongoing work must be landed sooner, commits 1–4 may be reviewed independently while commit 5 remains blocked. Do not merge unsafe snapshot restore merely to keep it in the same delivery.

## Security and operational acceptance checklist

- [ ] Restore targets are created/owned by the snapshot tool or explicitly confirmed with a destructive flag.
- [ ] Snapshot metadata is schema-validated and never interpolated into SQL.
- [ ] Archive and metadata integrity are verified together.
- [ ] Snapshot contents have a documented privacy/access policy.
- [ ] All node connections enforce read-only behavior.
- [ ] Replica TLS authenticates the server; `sslmode=prefer` is not the production ceiling.
- [ ] Readiness endpoints are idempotent and read-only.
- [ ] A populated unbound index cannot be claimed by the first manifest that probes it.
- [ ] Migration asset recovery is scoped to the exact deployment policy.
- [ ] Migration cursor reset is based on pre-delete evidence.
- [ ] Batch sizes are bounded and mapping failures abort rather than degrade silently.
- [ ] No resolved settlement hash is emitted when observations differ and comparability is unproven.
- [ ] Query-count and p95 budgets are enforced for block, transaction, metrics, ingestion, and decoding.
- [ ] Rollback restores both schema compatibility and cursor/index state.

## Verification evidence for this review snapshot

Passed:

- backend TypeScript check;
- backend documentation validation: 17 pages, all repository links and documented commands resolved;
- frontend TypeScript check;
- frontend ESLint for application, E2E, and scripts;
- targeted backend suite: 6 files, 52 tests, 0 failures, including corrected outref batching;
- an earlier targeted frontend run in this review: 6 files, 107 tests, 0 failures.

Not green or not independently proven:

- frontend Prettier check: 8 files require formatting;
- the complete backend database/service suite could not be independently rerun in the restricted review environment; loopback database/port access is denied, and the attempted elevated run was unavailable;
- previously reported backend `483 + 48` and frontend `428` green counts certify an earlier worktree snapshot, not every subsequent edit;
- no deployed replica was available for standby-specific validation;
- no live block currently proves multiple L2 transactions sharing one settlement transaction;
- the live index migration remains intentionally unexecuted.

## Final recommendation

Proceed with the direction, but do **not** approve the current worktree as one completed implementation. Treat snapshot safety, migration correctness, explicit binding adoption, and freshness/reconciliation semantics as release blockers. Then complete the response snapshot boundary and make CI prove nonempty cross-source behavior.

The best achievable repository design is:

- streaming replica for production L2 availability;
- primary fallback only by explicit operational policy;
- restored real-data snapshot for offline development;
- fixtures for deterministic tests;
- explorer-owned Cardano index for L1 attribution;
- one canonical association resolver with evidence from both sources;
- short read-only repeatable-read transactions for multi-query L2 responses;
- no full application-level projection of mutable Midgard state.

That is the simplest architecture that preserves correctness under updates and deletions, supports offline development, avoids requiring a local node every session, and keeps L1 lag from taking L2 exploration offline. Its remaining path to “10/10” is not more abstraction: it is closing the named safety gaps, measuring the latency tradeoff on a real replica, and generating the live many-to-one traffic required to prove the central relationship.
