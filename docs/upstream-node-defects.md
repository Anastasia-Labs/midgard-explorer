# Defects in the Midgard node that the explorer cannot fix

Two data problems live in the node's own Postgres. The explorer reads that
database and never writes to it, so no change here can correct either one. Both
were found while building the metrics panel, and both currently force the
explorer to hide a figure rather than report a wrong one.

Raise these with whoever runs the node.

## 1. Settlement latency is negative

Every row in `pending_block_finalizations` records `updated_at` **five to eight
minutes before** `block_end_time`.

Taken literally, a block finished settling before it stopped being produced. The
explorer computes settlement latency as `updated_at - block_end_time`, which is
therefore negative for every row, so the panel excludes the figure instead of
displaying it. A viewer sees no latency rather than a nonsense one.

Either `updated_at` is being written from a different clock or a different
event than the name suggests, or `block_end_time` is set later than the row it
belongs to. Whichever it is, the explorer cannot tell them apart from the
outside.

## 2. Six finalizations against one block

The node reports 6 rows in `pending_block_finalizations` while `blocks` holds a
single block.

If a finalization is per block, five of those rows have no block. If it is per
event within a block, the table name and the explorer's reading of it are both
wrong. The explorer currently reports both counts as it finds them, which is
honest but leaves a reader to reconcile two numbers that should agree.

## 3. Rebuilding the node against its existing volume is expected to fail

Not a defect in the data the explorer reads, and the one on this page most
likely to cost a day.

**What.** The live node database records **12** applied migrations by name:
`da_payloads_v2`, `deposit_submission_attempts`, `durable_tx_admissions`,
`forced_transactions`, `initial_schema`, `local_mutation_jobs`,
`pending_finalization_journal_payloads`, `pending_finalization_trace_members`,
`pending_finalization_trace_payloads`, `pending_finalization_utxo_payloads`,
`state_queue_mutation_leases` and `withdrawal_events`. The node checkout that
runs against it declares **one** migration file,
`src/database/migrations/sql/0001_initial_schema.sql`. Counted on both sides on
2026-09-17 and again on 2026-09-18.

**Why it matters here.** The node's migration runner tracks checksums and has a
`verification_failed` state, so a rebuild against the existing volume is
expected to fail verification rather than migrate. The explorer reads seven of
that database's tables, so the failure arrives as an explorer with no data and
a node that will not start.

**What to do instead.** Do not rebuild the node as routine housekeeping. The
branch in use is level with its upstream, and the branches that move change
none of the tables the explorer reads, so there is nothing here to gain from a
rebuild. If one is genuinely needed, treat it as a data migration with a
snapshot taken first: `backend/scripts/snapshot.mjs` exists for that and
refuses any target it did not judge to be its own.

**Not attempted.** Both sides were counted. The rebuild was not run, so the
failure is expected from the runner's own rules rather than observed.

## Why these are recorded rather than worked around

A workaround here would be the explorer inventing a plausible figure from data
it knows to be inconsistent. Everything this project has learned says the
opposite: report what exists, say when something cannot be confirmed, and never
present a derived number as a measurement. The node owns these tables and the
correction belongs there.

## Related

`docs/superpowers/NEXT-SESSION.md` section 7 records both alongside the
structural point they illustrate: some defects are outside the reach of any
change made here, and a code review of this repository could never have found
them.
