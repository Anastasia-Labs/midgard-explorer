-- Removes the implicit table access every role in this database inherits.
--
-- SEPARATE FROM explorer-reader-role.sql, AND DELIBERATELY SO. Every role is a
-- member of PUBLIC, so a table granted to PUBLIC is readable by
-- `explorer_reader` no matter how narrow its own grants are, and closing that
-- is the only way the least-privilege login is actually least-privilege.
--
-- But the statement below is not scoped to explorer_reader. It changes what
-- EVERY role in this database may do, including the Midgard node's own login
-- if that login reads any table it does not own. Running it as part of creating
-- a read-only user would make a database-wide privilege change a side effect of
-- adding one account, which is not a decision a setup script should take on an
-- operator's behalf.
--
-- Run it only after confirming which roles depend on PUBLIC grants here:
--
--   SELECT relname, relacl FROM pg_class
--    WHERE relnamespace = 'public'::regnamespace
--      AND relkind = 'r'
--      AND array_to_string(relacl, ',') LIKE '%=r%'
--      AND array_to_string(relacl, ',') NOT LIKE '%explorer_reader%';
--
--   psql -h <primary-host> -U postgres -d midgard \
--        -f backend/sql/explorer-reader-revoke-public.sql

\set ON_ERROR_STOP on

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
