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
