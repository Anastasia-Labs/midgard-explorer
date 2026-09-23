# 6. Cross-layer identity and association

Accepted 2026-09-02.

## Decision

An indexed Midgard block is identified by its own 28-byte header hash, taken from
the state-queue NFT the commit transaction mints. The explorer derives cross-layer
relationships at read time and never persists them. One index database serves one
deployment, and a persisted binding enforces it.

| Term | Means | Width |
|---|---|---|
| `header_hash` | a Midgard L2 block header hash | 56 hex |
| `utxos_root` | the Merkle root of that block's UTxO set | 64 hex |
| `l1_tx_hash` | a Cardano transaction hash | 64 hex |

These three were not distinguished before. `l1_block_header.header_hash` held a
`utxos_root`, so the column named after the identity contained the commitment.

## Why the key was wrong, and what it cost

`ingest.ts` wrote `headerHash: header.utxosRoot`. The decoder had already
separated the two, validating roots at 64 hex and key hashes at 56, so the
mistake was in the assignment and not in the reading.

Nothing that consumed the key could work. `/api/l1/block-header` validates its
parameter at 56 hex, which the stored key never was, so the block page's Cardano
evidence lookup returned 404 for every block in the deployment. The page caught
that and rendered "the explorer-owned Cardano index has not attributed its
Cardano commitment transaction", which was false: the index had attributed all
nine, correctly. Three separate pages built dead `/block/<hash>` links from the
same value.

The gates stayed green because the end-to-end fixture served the L2 header hash
under `headerHash`, so the join worked in every test and in no deployment.

## The canonical hash comes from the minted asset

A state-queue commit transaction mints exactly one NFT whose asset name is the
`MBLC` prefix followed by the block's header hash. The protocol treats that
suffix as the identity: `midgard-sdk` derives it as
`hashHexWithBlake2b(Data.to(header, Header), 28)` and reads it back with
`headerHashFromStateQueueUTxO`, which drops the prefix and returns the rest.

Ingest reads the asset on the exact output it is classifying. The transaction
also carries the previous queue node it re-outputs, so a transaction-wide lookup
would have two candidates and no way to choose. Backfill of rows that already
have an attributed transaction can use the mint, because only the new head is
minted.

An ambiguous or absent candidate is refused rather than guessed.

## What is not the source of the identity

`prev_header_hash` is the preceding block's hash. It corroborates a derived value
and can never attribute the newest block, which has no successor. It is a
cross-check and never a derivation.

The confirmed-state root node is out of scope. `midgard-sdk` reads its hash from
the datum rather than from an asset name, but the explorer only writes an
`l1_block_header` row when the 19-field header decoder succeeds, and a
confirmed-state datum does not satisfy it. No such row exists. The two undecoded
state-queue outputs in the index carry no `MBLC` asset, which is what that datum
shape predicts.

## One deployment per index

Only `l1_event` carried a deployment column, so `l1_tx`, `l1_tx_io`,
`l1_redeemer`, `l1_tx_asset` and `l1_block_header` could not be filtered even in
principle. The readiness suite permitted predecessor-deployment rows on the
grounds that the read path excludes them, which is true of one table and false of
the other five.

Rather than add a deployment column and a filter to every table, the index is
bound to one deployment by a single persisted row carrying the deployment id, the
network and magic, the manifest identity and schema version, the L2 database name
and the binding time. Startup and readiness refuse a manifest that disagrees with
it. Reusing an index for another deployment requires an explicit rebuild or a
recorded adoption.

The L2 database persists no protocol deployment identity of its own, only a
migration-bundle hash, so this binding is an operator assertion the explorer
records faithfully rather than a fact it can derive.

## Associations are derived, not stored

Five relationships, resolved at read time from records that already exist:
`block_settlement`, `l2_transaction_settlement`, `deposit_origin`,
`withdrawal_request` and `forced_transaction_order`. The last three are
provenance and not settlement: a deposit's L1 hash is where funds came from, and
a withdrawal's is where the request was made, not where a payout landed.

No association table. Nothing in the audit found a relationship that existing
rows cannot express, and a materialised copy would be a second thing to keep
correct.

## Disagreement is a result, not an error

The node's finalization journal is authoritative for intended submission. The
explorer's index is authoritative for what Cardano was observed to hold. They can
disagree, and both are kept when they do.

The two live in different databases and can never share one snapshot, so every
association carries `l2ObservedAsOf` and `l1ObservedAsOf` alongside both source
identities. `mismatch` is reported only when both sources are verified and fresh
enough to be compared. Otherwise the result is `node_only`, `index_only`,
`stale` or `unavailable`. Without that rule ordinary replication lag would raise
a false integrity alarm, which would discredit the mechanism that exists to
report real ones.

The journal is also not a complete history. The node retains one submitted hash
per header and deletes never-submitted rows outright, so the explorer must not
describe it as a record of every attempt.

## External explorers receive proven hashes only

A Cardano explorer URL is built from a validated 64-hex transaction hash that the
index holds evidence for. Search previously offered a Cardano link for any 64-hex
input, which meant pasting an L2 transaction id produced a live link to a
transaction that does not exist on Cardano. An L2 identifier is never substituted
into an L1 URL, and an unindexed hash gets no external action.

## Consequences

`l1_block_header.header_hash` changes meaning in place rather than gaining a
second canonical column. The table carries no relation in or out, holds nine live
rows, and already stores the root correctly in `utxos_root`, so a permanent
second identity would be duplication rather than migration. The one component
that cannot tolerate the change is the old writer, which the 56-hex check
constraint stops.

Every acceptance claim about this work is measured against the node and the index
together. A test that reads one source proves nothing about the relationship
between them, which is how the original defect survived nine local gates and
hosted CI.
