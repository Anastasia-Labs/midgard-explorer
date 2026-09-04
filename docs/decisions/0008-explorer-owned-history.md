# 8. Explorer-owned durable history for finalized L2 data

Proposed 2026-09-04. Supersedes ADR 0007 in part.

## Decision

Explorer-owned PostgreSQL becomes the durable serving store for **finalized and historical** L2 data. The Midgard node remains the upstream authority and continues to serve **volatile current state**. Each route moves to the explorer store only after backfill, reconciliation, shadow parity and a measured cutover.

Demo fixtures derive from the same canonical data model and the same protocol codecs, and remain explicitly labelled synthetic.

## Product requirement

Stated by the repository owner on 2026-09-04:

> We should always use real node data rather than fixtures, because we will be fetching
> from Midgard's database to our explorer, and if we can persist it, we should use that
> data.

Read precisely, this is two requirements, and only the second is new:

1. **Prefer real data over synthetic wherever real data exists.** Already satisfiable today for L1 (the explorer index holds 281 real preprod transactions) and already the intent of ADR 0007's snapshot mode for L2.
2. **Keep what we fetch.** The explorer reads Midgard's database on every request and retains none of it. Nothing in the current architecture makes explorer-visible history durable independently of the node's retention policy. This is what ADR 0007 does not provide and what this ADR adds.

## Serving boundary

Which store answers which question. This is the contract; everything else in this ADR exists to make it true.

| Data class | Served from | Authority | Why |
|---|---|---|---|
| Finalized block headers and commitments | **Explorer store** | Node, reconciled | Immutable once finalized; we own the index |
| Finalized transaction bodies and membership | **Explorer store** | Node, reconciled | Append-only per block |
| DA payload metadata | **Explorer store** | Node, reconciled | Carries `updated_at` |
| Events attached to finalized blocks | **Explorer store** | Node, reconciled | Terminal state |
| Non-finalized finalization state | **Node / replica** | Node | Mutable, and short-lived states can vanish between polls |
| `mempool`, `processed_mempool` | **Node / replica** | Node | A row moves table, which is a delete plus an insert |
| `tx_admissions`, `tx_rejections` | **Node / replica** | Node | Volatile admission lifecycle |
| `confirmed_ledger`, `mempool_ledger` | **Node / replica** | Node | Defined by deletion on spend |
| Cardano L1 index | **Explorer store** | Koios, already ours | Unchanged by this ADR |

The node is the authority for **every** class, including those the explorer serves. The explorer store is a durable observation of it, never a competing source of truth. Where the two disagree, the node wins and reconciliation records the disagreement rather than hiding it.

## What ADR 0007 decided, and what still stands

ADR 0007 rejected projecting the node's tables into explorer-owned copies, on two grounds. **The second ground stands unchanged and this ADR does not touch it.**

> The node's schema cannot support incremental projection. Most of the tables the explorer reads carry no `updated_at`, and several are defined by deletion.

Verified 2026-09-04 against the schema fixture. **5 of the 22 in-scope tables carry `updated_at`**: `pending_block_finalizations`, `da_payloads`, `withdrawal_utxos`, `forced_transaction_utxos`, `tx_admissions`. The two operator tables are not among the 22 and are not counted here; an earlier draft said "7 of 22" by adding them to the in-scope total, which was wrong twice. A transaction genuinely moves between `mempool`, `processed_mempool` and `immutable`, which is a delete plus an insert. `confirmed_ledger` and `mempool_ledger` rows are deleted when spent. `deposits_utxos` has no `updated_at` and its `status` advances with no timestamp changing.

**So wholesale projection remains rejected.** This ADR narrows the scope to the subset where the objection does not apply, and accepts a different synchronization model for the rest.

The first ground is narrowed rather than overturned:

> The availability goal is already met, one layer down. `docker-compose.replica.yml` provisions a standby with `pg_basebackup --wal-method=stream`.

True, and this ADR keeps the replica. A streaming replica solves **availability and consistency**. It does not solve **retention**: WAL replay reproduces deletions faithfully, so anything the node prunes the replica prunes too. Retention is the requirement this ADR addresses and ADR 0007 did not consider.

## Evidence, including what does not support this

**What supports it.** The node's documented behaviour deletes history: `blocks` rows are cleared after merge, `pending_block_finalization_*` members cascade-delete with their finalization, ledger rows are deleted when spent. A block explorer whose history can disappear is not a block explorer.

**What does not support it, stated because it would be easy to imply otherwise.** There is **no observed data loss in this deployment**. Checked 2026-09-04: all 9 finalized blocks retain their journal membership, and `expected_l2_transaction_count` equals the journal row count on every one of them. Seven of the nine legitimately contain zero transactions. Nothing has been lost yet.

The case for this ADR is therefore **prospective**, resting on documented node behaviour, not on damage already done. Anyone reading this later should not find a loss claim that the data never supported.

**The second motivation is index ownership.** The explorer cannot add an index to a database it reads read-only. `pending_block_finalizations` has no index on `block_end_time`, which is the leading sort key for the blocks and transactions lists. Once those routes read explorer-owned tables, we own that index and the upstream request (UR-1) becomes unnecessary for them.

## Scope

**Moves to the explorer store**, in this order:

1. Finalized block headers and their commitment set.
2. Finalized transaction bodies and block membership.
3. DA payload metadata.
4. Deposits, withdrawals and forced transactions attached to finalized blocks.
5. Source provenance and reconciliation state for all of the above.

**Stays on the node or its replica**, initially and possibly permanently:

- `mempool`, `processed_mempool`, `tx_admissions`, `tx_rejections`: volatile admission state.
- `confirmed_ledger`, `mempool_ledger`: current ledger, defined by deletion.
- Non-finalized `pending_block_finalizations` rows and their members.

## Synchronization

Three mechanisms, because one does not fit the whole surface. Choosing per table is the point.

| Mechanism | Where | Why |
|---|---|---|
| **Incremental watermark, with overlap and reconciliation** | `pending_block_finalizations`, `da_payloads`, `withdrawal_utxos`, `forced_transaction_utxos` | These carry `updated_at`, but see the caveat below: presence is not maintenance |
| **Generation-based full reconciliation** | `deposits_utxos`, and any mutable current-state table without `updated_at` | A watermark cannot see a status change with no timestamp. Each pass writes a generation id; rows absent from the newest generation are marked no longer observed, never silently dropped |
| **Append-only observation model** | Finalized members, transaction bodies | Records what was observed and when: source key, payload hash, first observed, last observed, and explicit coverage gaps |

**`updated_at` is not trustworthy on its own, and the schema proves it.** All four columns are declared `timestamp with time zone DEFAULT now() NOT NULL`, and **the node schema contains no triggers at all**: zero `CREATE TRIGGER` and zero `CREATE FUNCTION` in the dump. A `DEFAULT` fires on `INSERT` and never on `UPDATE`. So the column advances only if the node's application code sets it explicitly in every statement that modifies a row. That is upstream code we do not own and cannot audit, and a single `UPDATE` that omits it makes a row permanently invisible to a naive watermark.

The watermark is therefore used with three qualifications, all of which are requirements on the implementation:

1. **Order and page by `(updated_at, primary key)`, never `updated_at` alone.** Many rows share a timestamp, and a watermark that resumes at a bare timestamp either re-reads or skips the rest of that group.
2. **Scan with a deliberate overlap window**, re-reading a bounded period behind the watermark on every pass, so a late or clock-skewed write is picked up rather than stepped over. The window is a stated parameter, not an implicit constant.
3. **The watermark is an optimisation, not the correctness mechanism.** Generation-based reconciliation is what establishes correctness, and it runs over the watermark tables too, not only over the tables that lack the column. If reconciliation finds rows the watermark missed, that is recorded as a disagreement, and its rate is a monitored figure. A rising rate means the upstream does not maintain the column, and the affected table moves to full reconciliation.

Concretely: watermark for freshness, reconciliation for truth.

**The L1 cursor strategy does not transfer.** The L1 indexer advances a height cursor over an append-only chain. The L2 surface has rows that move between tables, rows deleted on spend, cascade deletes, status changes with no timestamp, and short-lived states that can appear and vanish between two polling passes. A height cursor captures none of that. The L1 lane contributes its **patterns**, which are proven and reusable, and none of its **cursor semantics**:

| Reusable from the L1 lane | Not reusable |
|---|---|
| Leadership election | Height cursor |
| Deployment binding | Append-only assumption |
| Transactional ingest | Single monotonic watermark |
| Reconciliation pass structure | Chain-order backfill |

Until a vertical slice proves otherwise, **this is a large item, not a second lane through known infrastructure.** An earlier planning note claimed the latter; that claim is withdrawn.

## What we may and may not claim

Without change data capture or an upstream event log, the explorer sees only what it polled. Every surface built on this store says **"observed by the explorer"**, with its coverage window and known gaps. It never says "complete history". A gap in observation is rendered as a gap, never as an absence of events.

## Finality, correction and staleness

Three different events look alike from a poller's position and must not be conflated. The distinction is a requirement on the implementation, because the wrong classification either loses real history or preserves a wrong answer forever.

| Event | What the explorer observes | What the explorer does |
|---|---|---|
| **Pruning** | A row we persisted is no longer present upstream, and its content never changed while we could see it | Keep it. This is the case this ADR exists for. Mark it `no longer observed upstream`, with the generation that last saw it |
| **Correction** | A row we persisted is still present upstream but its content now differs | The node wins. Replace the served value, retain the prior observation, and record the disagreement. Never silently overwrite without a trace |
| **Rollback** | A block we recorded as finalized is contradicted upstream, whether by disappearance with a replacement at the same height or by a changed commitment | Treated as a correction, and additionally **quarantines the route**: the affected route reverts to reading the node until reconciliation clears |

**"Finalized" here means the node's `status = 'finalized'`, which is an L2 statement, not L1 settlement.** The two are separate and the explorer already renders them separately. Persisting a block whose L2 status is `finalized` says nothing about whether its commitment is settled on Cardano L1, and no persisted-store surface may imply otherwise.

**Behaviour when the persisted store is stale or incomplete.** A cut-over route does not silently serve whatever it has. Every response from a cut-over route carries its freshness (the timestamp of the newest successful reconciliation for its tables) and its coverage (whether the requested range is fully within an observed window).

| Store condition | Route behaviour |
|---|---|
| Fresh, within the stated bound, coverage complete | Serve from the explorer store |
| Freshness outside the stated bound | Fall back to the node for that request, and report the degraded source in the response |
| Coverage gap inside the requested range | Serve what is observed and render the gap **as a gap**, never as an absence of events. A list must not present a hole as the end of the data |
| Reconciliation reported a disagreement on the requested entity | Serve the node's answer |
| Node unreachable and store stale | Serve the store, labelled stale with its age. This is the one case where stale beats nothing, and it is labelled |

The staleness bound is a stated parameter per route, approved before that route cuts over, and it is measured. A route whose freshness bound is not met is not cut over.

## Cutover, per route

A route moves only after all five, in order:

1. Backfill completes for that route's tables.
2. Shadow reads run against both sources and their results are compared.
3. Semantic parity passes, not merely row counts.
4. Freshness and coverage are exposed in the response.
5. The route's existing budgets stay green, measured before and after.

A route that fails any step keeps reading the node. Cutover is per route, never global.

## Fixtures

**One pipeline, not three generators.** An earlier draft said one canonical model produces all three artifacts independently. That is not sufficient: three generators sharing a model can still disagree with what the real routes actually return, because only one of them ever runs the route code. The direction is a chain, and each stage is derived from the previous one:

```
canonical records  ->  SQL seed  ->  real backend routes  ->  contract-validated snapshots  ->  demo server
```

- **Canonical records** are the single source, satisfying the invariants in `docs/dataset-profiles.md`.
- **SQL seed** is generated from them and loaded into a throwaway database.
- **Real backend routes** are then exercised against that database. Nothing hand-writes a response body.
- **Contract-validated snapshots** are the captured responses, each validated against the schema in `frontend-new/contracts/src/` before it is written. A response that fails its contract fails the build.
- **Demo server** replays those snapshots.

The property this buys, which the three-generator design did not: a fixture cannot describe a response the real route would never produce. Contract drift, route changes and codec changes all break the fixture build rather than being discovered later against a stale artifact.

**ADR 0003's `demo` mode keeps its property of needing no Docker and no PostgreSQL.** It is the mode a first-time contributor uses, and requiring a database would remove its reason to exist. The fixture server continues to serve generated responses.

Two fixture tiers:

- **Golden real captures**: representative real payloads and edge cases, captured from a real deployment.
- **Deterministic generated extensions**: scale, skew and lifecycle coverage, produced through the protocol codecs.

Both are visibly labelled fixture data. Snapshots remain the mode for exact real-but-stale data.

**Placeholders must go.** `backend/scripts/generate-l2-seed.mjs:119-132` fills any column nothing meaningful sets with a digest of the column name: type-correct and shape-correct, but semantically empty. That was adequate when the seed existed to prove pages render. It is not adequate now that the seed backs performance measurement and coverage claims. Every field marked `adopt` or already exposed in `docs/coverage-manifest.json` must receive a semantically valid value, and the generator must fail rather than emit a placeholder for one.

## Migration strategy

No route changes behaviour until its own gate passes. There is no global switch and no flag day.

**Phase 1: additive schema, zero read change.** New models in `backend/prisma-indexer/schema.prisma` under a distinct prefix so they cannot collide with the L1 lane. Migrations are additive; nothing existing is altered. Every route still reads the node. The store is written and unread.

**Phase 2: backfill.** Populate from the node as it stands today, recording for each row its source key, payload hash, first observed and last observed timestamps, and the generation id of the pass that saw it. Backfill is restartable and idempotent: re-running it must not duplicate or lose rows. Coverage gaps are recorded as gaps.

**Phase 3: shadow read.** The route reads both sources and serves the node's answer. The explorer answer is compared and the difference recorded. Parity is **semantic**, not row counts: same entities, same field values, same ordering, same pagination boundaries. Shadow runs for a stated period before any cutover, not for a single request.

**Phase 4: cutover, one route at a time.** The route serves the explorer store and continues to compare in the background for a stated period. Its budgets are re-measured before and after; a regression reverts the route.

**Rollback.** Reverting a route is changing which source it reads. The node is untouched throughout (it is read-only to us), the explorer store is additive, and no migration is destructive, so rollback is a configuration change rather than a data recovery. This property is a constraint on the design, not an accident: any change that makes rollback require data repair is out of scope.

**Retirement.** The generated `target` and `stress` profiles retire per route as real persisted volume reaches the size the budget needs. They are not deleted on the day of cutover; they are retired when real data can answer the same question, and the register records which rows moved from `generated` to `real`.

## Consequences

- The upstream index request (UR-1) narrows to routes still reading the node directly. It is not cancelled: those routes exist until every cutover completes, and may exist permanently for volatile state.
- Cursor pagination and owned indexes apply to the explorer store, where we control the schema, rather than being blocked on an upstream migration.
- The explorer takes on synchronization, reconciliation, coverage reporting and recovery obligations it does not have today. That is the cost, and it is the reason for the per-route cutover gates rather than a single switch.
- Baselines must be taken against the **current direct-node implementation first**, or there is nothing to compare a cutover against.
