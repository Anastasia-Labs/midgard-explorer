# Performance baseline

Recorded 2026-09-02 on `wip/dev-onboarding`, after the round-trip reductions and
before the replica exists. It is here so the replica comparison has something to
compare against, and so nobody has to reconstruct these numbers later.

## What the dataset is

Nine blocks and two L2 transactions. That matters more than the timings: at this
volume every route is dominated by connection and serialisation cost, so the
latency figures below are a floor and not a characterisation. **Do not quote
them as evidence that the optimisations worked.** The round-trip counts are that
evidence; the latency is what to re-measure once the data is real.

## Round trips, measured

| Path | Before | After | How it was measured |
|---|---:|---:|---|
| Ingest, one transaction | 20 | 11 | statement counter around `ingestTxInfos` |
| Ingest, 20 inputs x 3 assets | ~80 | ~11 | same shape, extrapolated from the row counts |
| Outref resolution per transaction | one per input, reference input and output | 1 | call counter in `outref-batching.test.mts` |
| `/api/metrics` | 13 | 9 | statements in `db/metrics.ts`, response diffed byte-for-byte |

## Latency, for comparison later

Thirty sequential requests each, on this machine, against the primary.

| Route | p50 | p95 | max |
|---|---:|---:|---:|
| `/api/metrics` | 2.3 ms | 3.7 ms | 356 ms |
| `/api/block` | 2.3 ms | 4.7 ms | 86 ms |
| `/api/transaction` | 2.4 ms | 6.2 ms | 27 ms |
| `/api/blocks/1` | 2.1 ms | 6.6 ms | 13 ms |

The `max` column is the first request of each run, which pays for connection
setup and any lazy initialisation. It is not a tail latency figure.

## What this cannot tell you

The block route reads six statements inside one `REPEATABLE READ` transaction, so
they serialise where they previously ran concurrently. At this volume that costs
about a millisecond, which is why it is not visible above. Against a populated
database it will be larger, and against a streaming standby the transaction also
meets replay conflicts, which no measurement on a primary can produce.

Re-run this after the replica is deployed and after the chain carries real
volume. Both figures should be reported, and the round-trip counts should be
re-derived rather than assumed to have held.
