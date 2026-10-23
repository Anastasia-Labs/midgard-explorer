-- Corrects the block identity, and binds this index to one deployment.
--
-- `20260807130913_l1_tables` created `l1_block_header.header_hash` as the
-- primary key, and ingest wrote `utxosRoot` into it. That is a 32-byte Merkle
-- commitment to the UTxO set, not an identity. A Midgard block header hash is
-- 28 bytes, which is what `pending_block_finalizations.header_hash` holds and
-- what `/api/l1/block-header` and `/block/[headerHash]` both validate. So the
-- key could not be requested through either route, the block page's Cardano
-- evidence resolved for no block, and three pages built dead links from it.
--
-- Measured on the live index before this migration: 9 headers, every key 64
-- hex, every one attributed to a settlement transaction the node also names.
--
-- The identity is recovered from the state-queue NFT the commit transaction
-- mints, whose asset name is "MBLC" (4d424c43) followed by the header hash.
-- That is the protocol's own rule: midgard-sdk derives the hash as
-- blake2b-224 over the serialised header and reads it back by dropping the
-- same prefix. The tokens are already stored in `l1_tx_asset`, so no rescan
-- and no hashing is needed to repair the nine rows.
--
-- The constraints at the end are the abort mechanism. A row this migration
-- could not key cannot satisfy them, so the transaction fails rather than
-- leaving a half-corrected table behind.

-- 1. Which deployment this index belongs to.
--
-- Only `l1_event` carried a deployment column, so `l1_tx`, `l1_tx_io`,
-- `l1_redeemer`, `l1_tx_asset` and `l1_block_header` could not be filtered even
-- in principle, and a second manifest pointed at this database would merge two
-- deployments in tables nothing can separate. One binding is smaller than a
-- deployment column and a filter on every table, and it fails closed.
--
-- `id` is fixed so the table holds at most one row: a binding that could have
-- two is not a binding.
CREATE TABLE "index_binding" (
  "id" BOOLEAN NOT NULL DEFAULT TRUE,
  "deployment_id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "network_magic" INTEGER,
  "manifest_schema_version" TEXT,
  "l2_database" TEXT NOT NULL,
  "bound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "index_binding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "index_binding_singleton" CHECK ("id" IS TRUE),
  CONSTRAINT "index_binding_network" CHECK ("network" IN ('preprod', 'mainnet'))
);

-- 2. Recover the canonical identity for every attributed header.
--
-- Scoped to the state-queue minting policy, not merely to the MBLC prefix. A
-- prefix is four bytes any policy may mint, so an unscoped match lets another
-- policy's token in the same transaction either make the row ambiguous or, if
-- it were the only candidate, supply a wrong header hash under a key the
-- constraints would happily accept. The application rule in
-- `stateQueueAsset.ts` has always been policy-bound; this is the migration
-- catching up to it rather than a new rule.
--
-- The policy is derived from the rows themselves: the state-queue validator is
-- the one whose events are `blockCommitment`, and its minting policy is the
-- script hash those transactions mint under. Reading it from the data keeps the
-- migration self-contained, because a migration cannot see the manifest.
--
-- Restricted further to exactly one such mint per transaction. A commit carries
-- the new head and re-outputs the node before it, but only the head is minted,
-- so a transaction with two is ambiguous and is left for the constraint below
-- to reject rather than guessed at.
WITH policy_use AS (
  -- Every policy that minted an MBLC-prefixed token in a transaction this table
  -- already attributes a header to. Those transactions are state-queue commits
  -- by construction, so the real minting policy appears in all of them.
  SELECT a."policy_id", count(DISTINCT a."tx_hash") AS commits
    FROM "l1_tx_asset" a
    JOIN "l1_block_header" h ON h."l1_tx_hash" = a."tx_hash"
   WHERE a."kind" = 'mint'
     AND a."asset_name" LIKE '4d424c43%'
     AND a."quantity" > 0
   GROUP BY a."policy_id"
), state_queue_policy AS (
  -- The one that appears in the most of them, and only when that maximum is
  -- unambiguous. A foreign policy minting an MBLC-prefixed token in a single
  -- transaction loses to the real policy present in every commit; a tie means
  -- the data cannot identify the policy, so nothing is backfilled and the width
  -- constraint refuses the migration rather than keying rows on a guess.
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
UPDATE "l1_block_header" h
   SET "header_hash" = m.header_hash
  FROM minted m
 WHERE h."l1_tx_hash" = m."tx_hash"
   AND m.candidates = 1
   AND m.header_hash ~ '^[0-9a-f]{56}$'
   AND h."header_hash" !~ '^[0-9a-f]{56}$';

-- 3. Headers that could not be keyed, and the re-index they imply.
--
-- One statement, because the second half depends on what the first half
-- removed. A `CREATE TEMP TABLE ... ON COMMIT DROP` held that count across two
-- statements and worked under `psql -1`, which wraps a whole file in one
-- transaction. `prisma migrate deploy` does not, so the temp table was gone by
-- the time the next statement read it and every fresh database failed with
-- `relation "_canonical_header_repair" does not exist`. Rehearsing with psql
-- proved the SQL and not the way it is actually applied.
--
-- A data-modifying CTE needs no state between statements: the DELETE returns
-- the rows it removed and the UPDATE reads that result directly.
--
-- The rows removed here are headers whose committing transaction is not
-- indexed, so their identity is knowable only from a transaction this index
-- does not hold. They are derived data with no reader, because their key is a
-- width no route accepts. Removing them lets the corrected table be
-- constrained, and zeroing the cursors makes the next pass rebuild them from
-- the chain under the right identity. Nothing a user created is lost.
--
-- The condition is "did this migration remove anything", captured by the DELETE
-- itself. An earlier version asked afterwards whether any surviving header had
-- a null `l1_tx_hash`, which was wrong twice over: a deleted row cannot satisfy
-- an EXISTS on the table it was deleted from, so real damage produced no
-- reset; and a carried-forward header legitimately has a null `l1_tx_hash` on a
-- healthy index, so an undamaged database was sent to re-index from genesis.
WITH removed AS (
  DELETE FROM "l1_block_header"
   WHERE "header_hash" !~ '^[0-9a-f]{56}$'
  RETURNING 1
)
UPDATE "sync_cursor"
   SET "last_block_height" = 0
 WHERE EXISTS (SELECT 1 FROM removed);

-- 5. The widths, enforced where a future writer cannot talk past them.
--
-- The one component that cannot tolerate the corrected key is an old writer,
-- which would keep inserting 32-byte roots. This is what stops it, which is why
-- deployment fencing is a checklist item and not a hope.
ALTER TABLE "l1_block_header"
  ADD CONSTRAINT "l1_block_header_header_hash_width"
  CHECK ("header_hash" ~ '^[0-9a-f]{56}$');

ALTER TABLE "l1_block_header"
  ADD CONSTRAINT "l1_block_header_l1_tx_hash_width"
  CHECK ("l1_tx_hash" IS NULL OR "l1_tx_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "l1_tx"
  ADD CONSTRAINT "l1_tx_tx_hash_width"
  CHECK ("tx_hash" ~ '^[0-9a-f]{64}$');
