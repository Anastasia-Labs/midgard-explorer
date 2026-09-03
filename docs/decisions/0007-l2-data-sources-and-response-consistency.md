# 7. L2 data sources and response consistency

Accepted 2026-09-02.

## Decision

The explorer reads Midgard through three sources, each matched to one job, and
never projects the L2 database into tables of its own.

| Where | Source | Why |
|---|---|---|
| Production | a PostgreSQL streaming replica | complete and near real time, and it survives the node being unavailable |
| Offline development | a verified snapshot of real Midgard data | the explorer runs without starting Midgard |
| Automated tests | deterministic fixtures | a test that depends on live data is not a test |

The frontend always reads through the explorer backend. There is no polling
projection and no duplicated L2 schema.

## Why not an application-level read model

Projecting the node's tables into explorer-owned copies was considered and
rejected on two grounds, both checkable.

**The availability goal is already met, one layer down.**
`docker-compose.replica.yml` provisions a standby with `pg_basebackup
--wal-method=stream` against a replication slot, and
`docs/production-data-path.md` documents the slot, the grants and the WAL
retention. WAL replay cannot miss an update or a deletion and is transactionally
consistent at every instant. An application-level projection reimplements that
with weaker guarantees and more code.

**The node's schema cannot support incremental projection.** Most of the tables
the explorer reads carry no `updated_at`, and several are defined by deletion:

- `deposits_utxos` has no `updated_at`, and its `status` moves awaiting →
  projected → consumed with no timestamp changing.
- A transaction MOVES between `mempool`, `processed_mempool` and `immutable`,
  which is a delete plus an insert.
- `confirmed_ledger` and `mempool_ledger` rows are deleted when spent.
- `blocks` rows are cleared by the node after merge.
- `pending_block_finalization_txs` is cascade-deleted with its finalization.

A timestamp checkpoint sees none of that, so the reconciliation pass that was
meant to catch what polling missed would be a full-table diff for most of the
surface. That is periodic copying with a checkpoint in front of it, and the
claimed advantage of reliable catch-up is exactly the part the schema does not
provide.

## One snapshot per response

Every multi-query L2 response reads inside one short `READ ONLY`,
`REPEATABLE READ` transaction.

There was no transaction anywhere: no `$transaction`, no isolation level, no
`BEGIN` in `db.ts`, in any of `db/*.ts`, or in any route. One block page is about
nine independent statements, six of them concurrent, each taking its own
snapshot. Against the primary that is a mild inconsistency while the node
writes. Against a standby it is sharper, because replay advances between
statements, so a header can be read at one replay position and its finalization
at another. That manufactures the node-versus-index disagreement the association
model exists to report honestly, from inside a single response.

The scope is the aggregates, not every function: the six detail routes and the
four paginated `rows` plus `count` pairs. `db/l1.ts` is excluded because it reads
the explorer's own database, which is not a standby.

Two costs are accepted. Prisma runs a transaction's queries on one connection, so
queries currently issued through `Promise.all` serialise; the answer is to
combine related statements with joins and CTEs and to measure before and after
rather than assume. And a long read on a standby can be cancelled under
`max_standby_streaming_delay`, so these transactions stay short and a known
transient conflict is retried once with bounded jitter.

## Sources identify themselves

`isFixtureDatabase` named live by exclusion, which is right about fixtures and
wrong about snapshots: a restored snapshot of real Midgard data would have been
reported as synthetic. The source now states which of four kinds it is, and it is
asked of PostgreSQL rather than derived from configuration, because the incident
this whole area exists to prevent was a URL that did not point where its name
implied. `pg_is_in_recovery()` cannot be wrong about a standby.

Freshness travels with it: a replica reports replay lag, a snapshot reports its
capture, a fixture reports that time does not apply. A stale replica or snapshot
stays usable and simply cannot be presented as current.

## L1 and L2 availability are independent

`/readyz` answers whether the Midgard explorer can serve, and reads the node
database only. `/readyz/l1` answers whether the Cardano surface can serve, and
owns the index, its reconciliation, the manifest and the deployment binding.
`/readyz/full` answers both, for a deployment gate that wants one call.

`/readyz` used to include all of it, and its verdict is `checks.every(ok)`, so an
index that had never reconciled removed the whole instance from rotation with
every L2 route inside it. `probeIndexDatabase` moved out with the rest: no L2
page reads the index, and keeping it would have moved the outage one probe to the
left rather than removing it.

## Consequences

The replica is provisioned and documented but not proved deployed, so the
production data path remains a design on paper until it is exercised, and the
response-consistency work must be verified against a real standby rather than
only against the primary. Snapshots are build artefacts carrying deployment,
network, capture time, schema fingerprint and checksum; they are not committed to
git.
