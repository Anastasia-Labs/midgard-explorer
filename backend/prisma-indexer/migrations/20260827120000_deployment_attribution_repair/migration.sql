-- Repairs attribution written under the shared column default.
--
-- `20260807164120_tx_detail` added `deployment TEXT NOT NULL DEFAULT 'default'`
-- to `l1_event`, and the ingest path never set the column. Every row therefore
-- landed under "default" while the validator query filters on the identity the
-- manifest declares, so events were indexed correctly and no query could return
-- one. Measured on the live index before this migration: 158 rows, all
-- "default", against a manifest identity of a56045c3.
--
-- Nothing is deleted. The rows are already unreachable, and they are derived
-- data that the next full pass rewrites under the correct identity. Resetting
-- the cursors is what causes that pass to happen; removing the rows first would
-- leave the index emptier than it is now for as long as the indexer is down.

-- 1. A row can no longer be written without stating its deployment. The
--    application now passes it as a required argument; this closes the same
--    hole at the schema, so a future writer cannot reintroduce it silently.
ALTER TABLE "l1_event" ALTER COLUMN "deployment" DROP DEFAULT;

-- 2. Re-index from genesis, but only where the damage is present. On a database
--    with no mis-attributed rows this is a no-op, so the migration is safe to
--    apply to a fresh deployment and safe to re-run.
UPDATE "sync_cursor"
   SET "last_block_height" = 0
 WHERE "source" IN ('l1', 'l1:mints', 'l1:rewards')
   AND EXISTS (SELECT 1 FROM "l1_event" WHERE "deployment" = 'default');
