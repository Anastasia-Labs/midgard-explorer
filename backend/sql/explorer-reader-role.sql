-- A least-privilege login for the explorer's reads of the Midgard node's
-- database. The backend already opens its Midgard sessions with
-- default_transaction_read_only=on, but that is the application promising
-- rather than the database enforcing, and an application promise survives
-- exactly as long as nobody changes the application.
--
-- Run it against the node's PRIMARY, as a superuser. A physical standby is
-- read-only and replicates roles from the primary, so the login must be
-- created there and will appear on the replica.
--
--   psql -h <primary-host> -U postgres -d midgard \
--        -v role_password="'a-strong-password'" \
--        -f backend/sql/explorer-reader-role.sql
--
-- Then put that login in MIDGARD_READ_REPLICA_URL and set
-- REQUIRE_MIDGARD_READ_REPLICA=true, so the backend refuses to boot rather
-- than falling back to the primary with wider permissions.

\set ON_ERROR_STOP on

-- Idempotent: re-running only refreshes the password and the grants. The
-- branch is a psql conditional rather than a DO block because psql does not
-- substitute its variables inside dollar-quoted text, so a password written
-- there would reach the server as the literal string :'role_password'.
SELECT NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'explorer_reader'
) AS role_is_new \gset

\if :role_is_new
CREATE ROLE explorer_reader LOGIN PASSWORD :'role_password';
\else
ALTER ROLE explorer_reader LOGIN PASSWORD :'role_password';
\endif

-- No inherited write path: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, no
-- membership of anything.
ALTER ROLE explorer_reader NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

-- Revoke before granting, so a rerun narrows the role instead of only adding
-- to it. Reusing an existing role kept every grant and every membership it had
-- picked up, and NOINHERIT does not prevent the login from calling SET ROLE to
-- reach a group it still belongs to. Least privilege has to be re-established
-- on each run or it is only least privilege on the first.
DO $revoke$
DECLARE
  g record;
BEGIN
  FOR g IN
    SELECT r.rolname
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
     WHERE m.member = 'explorer_reader'::regrole
  LOOP
    EXECUTE format('REVOKE %I FROM explorer_reader', g.rolname);
    RAISE NOTICE 'revoked membership of %', g.rolname;
  END LOOP;
END
$revoke$;

REVOKE ALL ON DATABASE :"DBNAME" FROM explorer_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM explorer_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM explorer_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM explorer_reader;
REVOKE ALL ON SCHEMA public FROM explorer_reader;
-- Anything a future default-privilege rule would have handed it.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE :"DBNAME" TO explorer_reader;
GRANT USAGE ON SCHEMA public TO explorer_reader;

-- SELECT on exactly the tables the explorer reads, and nothing else. A table
-- the node has not created yet is reported rather than silently skipped: a
-- schema change upstream is the most likely reason a name here goes missing.
DO $$
DECLARE
  wanted text[] := ARRAY[
    'address_history',
    'blocks',
    'confirmed_ledger',
    'da_payloads',
    'deposits_utxos',
    'forced_transaction_utxos',
    'immutable',
    'mempool',
    'mempool_ledger',
    'pending_block_finalization_deposits',
    'pending_block_finalization_forced_transactions',
    'pending_block_finalization_txs',
    'pending_block_finalization_withdrawals',
    'pending_block_finalizations',
    'processed_mempool',
    'tx_admissions',
    'tx_rejections',
    'withdrawal_utxos'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY wanted LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'not present in this database, no grant made: %', t;
    ELSE
      EXECUTE format('GRANT SELECT ON public.%I TO explorer_reader', t);
    END IF;
  END LOOP;
END
$$;

-- Deliberately absent: ALTER DEFAULT PRIVILEGES. A new node table becomes
-- readable only when someone adds it to the list above, which is the point of
-- naming them. Re-run this script after a node migration adds a table the
-- explorer needs.

-- What the login can actually do, as the database sees it.
SELECT
  c.relname AS table_name,
  has_table_privilege('explorer_reader', c.oid, 'SELECT') AS can_select,
  has_table_privilege('explorer_reader', c.oid, 'INSERT') AS can_insert,
  has_table_privilege('explorer_reader', c.oid, 'UPDATE') AS can_update,
  has_table_privilege('explorer_reader', c.oid, 'DELETE') AS can_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;
