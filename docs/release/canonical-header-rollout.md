# Rollout: canonical block key and deployment binding

The migration `20260902190000_canonical_header_and_binding` changes what
`l1_block_header.header_hash` MEANS. It held `utxosRoot`, a 32-byte Merkle
commitment; it now holds the 28-byte Midgard block header hash that every route
already validates.

Nothing about this is reversible by re-running it, so the order below matters and
each step names what it proves.

## Before you start

|                         |                                                                      |
| ----------------------- | -------------------------------------------------------------------- |
| Blast radius            | the explorer's own L1 index. The node's database is never written    |
| Downtime                | the indexer only. Read-only backends keep serving                    |
| The dangerous component | an OLD WRITER, which would keep inserting 32-byte roots              |
| Reversal                | restore the backup. The key change is not undone by a down-migration |

Rehearsed on a clone of the live index on 2026-09-02: `UPDATE 9, DELETE 0`, and
all nine keys then matched the node's `header_hash` exactly, with nothing
unmatched on either side.

## 1. Stop the writer, and prove it stopped

`pnpm services:down` is NOT that command. It stops only the containers this
package started, which is Postgres and the API cache; the indexer is a Node
process and keeps running, and keeps writing, with its database still up.

Stop whatever supervises the indexer on this host: the systemd unit, the pm2
entry, the Compose service, or the terminal running `pnpm dev`. Then prove it,
because the proof is the part that matters:

```sql
SELECT count(*) FROM pg_stat_activity
 WHERE datname = current_database()
   AND application_name = 'midgard-explorer-l1-indexer';
```

Zero. A writer still connected will fail its next insert against the new
constraint, which is the safe outcome, but it will also fail loudly in
production, and doing that on purpose is different from doing it by accident.

## 2. Back up the index

```bash
# The URL is NOT passed as an argument: everything on a command line is visible
# in `ps` to every user on the host, password included.
export PGHOST=... PGPORT=... PGUSER=... PGDATABASE=...   # PGPASSWORD, or a ~/.pgpass entry
pg_dump --format=custom --file l1-index-pre-canonical.dump
```

This is the reversal. There is no other one. Rehearsed: restoring this file
returned a damaged clone to its exact pre-migration state, cursors included.

## 3. Read what you are about to change

```sql
SELECT count(*)                         AS headers,
       count(l1_tx_hash)                AS attributed,
       min(length(header_hash))         AS min_key,
       max(length(header_hash))         AS max_key
  FROM l1_block_header;
```

Every key at 64 means the repair has not run. Every key at 56 means it has, and
this rollout is already complete. A mixture means a previous attempt stopped
part way: restore the backup rather than continuing.

`headers - attributed` is an UNDERCOUNT of what step 4 will delete, and using it
as the estimate is how a rollout gets a surprise. A header whose committing
transaction is present but carries no state-queue mint is equally unrecoverable
and is not counted by it.

This is the migration's own recoverability test, run as a query. What it returns
is exactly what will be deleted:

```sql
-- The migration's own recoverability test, predicate for predicate. A header is
-- recoverable only when its committing transaction carries EXACTLY ONE
-- state-queue mint whose asset name ends in a canonical 56-hex suffix; two
-- candidates or a malformed suffix are as unrecoverable as no mint at all, and
-- an earlier version of this query counted both as fine.
WITH policy_use AS (
  SELECT a."policy_id", count(DISTINCT a."tx_hash") AS commits
    FROM "l1_tx_asset" a
    JOIN "l1_block_header" h ON h."l1_tx_hash" = a."tx_hash"
   WHERE a."kind" = 'mint' AND a."asset_name" LIKE '4d424c43%' AND a."quantity" > 0
   GROUP BY a."policy_id"
), state_queue_policy AS (
  SELECT "policy_id" FROM policy_use
   WHERE "commits" = (SELECT max("commits") FROM policy_use)
     AND (SELECT count(*) FROM policy_use p2
           WHERE p2."commits" = (SELECT max("commits") FROM policy_use)) = 1
), minted AS (
  SELECT a."tx_hash",
         substring(a."asset_name" FROM 9) AS header_hash,
         count(*) OVER (PARTITION BY a."tx_hash") AS candidates
    FROM "l1_tx_asset" a
    JOIN state_queue_policy p ON p."policy_id" = a."policy_id"
   WHERE a."kind" = 'mint'
     AND a."asset_name" LIKE '4d424c43%'
     AND a."quantity" > 0
)
SELECT count(*) AS unrecoverable
  FROM "l1_block_header" h
 WHERE h."header_hash" !~ '^[0-9a-f]{56}$'
   AND NOT EXISTS (
     SELECT 1 FROM minted m
      WHERE m."tx_hash" = h."l1_tx_hash"
        AND m.candidates = 1
        AND m.header_hash ~ '^[0-9a-f]{56}$'
   );
```

Zero means nothing is deleted and the cursors are left alone. Any other number
is the count of headers that will be removed, and the cursors will reset so the
next pass rebuilds them.

## 4. Apply the migration

```bash
cd backend && pnpm indexer:deploy
```

The migration repairs every header whose committing transaction this index
holds, DELETES the headers it cannot key, and resets the sync cursors when it
deleted any, so the next pass re-indexes that range. The constraints at the end
are what makes that ordering safe: they cannot hold while a single unkeyable row
survives, so a backfill that silently missed one aborts the whole transaction
and leaves the table as it was rather than half corrected.

Rehearsed on a clone of the live index, in both directions:

| Starting state                | Headers               | Cursors after        |
| ----------------------------- | --------------------- | -------------------- |
| All nine recoverable          | 9 repaired, 0 deleted | unchanged at 5130584 |
| One carried-forward row added | 9 repaired, 1 deleted | reset to 0           |

Restoring the step 2 backup returned the database to its exact pre-migration
state: 64-character keys, cursors at 5130584, no `index_binding`, no migration
record.

An index that already applied a PRE-RELEASE copy of this migration is a case
worth knowing: `prisma migrate deploy` does not re-run it and does not report the
changed file, and neither does `prisma migrate status`. Do not infer from a clean
migration report that this index holds the corrected keys. Step 5 is the check
that answers it, and it reads the rows rather than the migration record.

## 5. Prove the repair against the node

The check that matters is not "did it run" but "do the two sources now agree".

```bash
REQUIRE_DB=1 pnpm exec vitest run test/cross-source-identity.test.mts
```

Then, against the live pair:

```sql
-- in the index
SELECT header_hash, l1_tx_hash FROM l1_block_header ORDER BY end_time;
-- in the node
SELECT encode(header_hash,'hex'), encode(submitted_tx_hash,'hex')
  FROM pending_block_finalizations ORDER BY block_end_time;
```

Every index row whose `l1_tx_hash` appears in the node's `submitted_tx_hash`
column must carry the same `header_hash` the node does. One that does not is a
stop: restore the backup.

## 6. Deploy the fixed writer, then start it

In this order. The new ingest keys headers from the `MBLC` token on the exact
output; the old one writes roots and will now be refused by the constraint.

```bash
cd backend && pnpm dev:l1        # or the production indexer unit
```

## 7. Claim the index for its deployment

Readiness only READS the binding. It used to write one on first sight, which
made a health check state-changing: whichever process was probed first claimed
the database for whatever manifest it happened to carry. An empty index is now
claimed by the writer on its first pass, and an index that already holds rows is
claimed only by an operator running the command below.

This index holds rows, so adopt it. The dry run reports what the existing events
say they belong to and refuses if any of them name a deployment the manifest
does not.

```bash
cd backend && pnpm adopt-index            # report, write nothing
cd backend && pnpm adopt-index --confirm  # write the binding
cd backend && pnpm readiness --scope=l1   # confirm it reads back
```

`deployment binding` READY means the index is now claimed. From here, pointing a
different manifest at this database is refused, and the refusal names the two
ways forward: point the process at that deployment's own index, or rebuild this
one.

## 8. Confirm the interface

- A block page shows its Cardano evidence rather than "not observed in the
  Cardano index yet".
- Every row on `/l1/commitments` reaches a block page.
- The block commitment action on an L1 transaction page reaches its block.

All three were dead before this migration, and all three come right from the key
alone with no frontend change.

## If it goes wrong

Roll the application back BEFORE reversing anything in the database, then restore
the backup from step 2. Do not attempt to repair rows by hand: a key that cannot
be derived from the token that minted it is a key nobody can prove, and writing a
plausible one is how the original defect would come back wearing different
clothes.
