# Production explorer data path

The production boundary is:

```text
browser / CDN
      |
      v
Nginx API cache :3102
      |
      v
explorer backend :3101
      |                         |
      v                         v
Midgard PostgreSQL replica      midgard_explorer PostgreSQL
(read-only L2 and DA rows)      (explorer-owned L1 index)
```

The backend must not be publicly reachable around the proxy. Permit traffic to
port 3101 only from the frontend and reverse proxy. Public traffic goes to the
proxy on port 3102 (or to a CDN whose origin is that proxy).

## Bounded database access

The backend now creates bounded PostgreSQL pools and applies a server-side
`statement_timeout` plus a slightly longer client query timeout. The Midgard
session also sets `default_transaction_read_only=on` even when the configured
role has more permission than it should.

Production settings:

```dotenv
MIDGARD_READ_REPLICA_URL=postgresql://explorer_reader:REDACTED@127.0.0.1:5436/midgard?schema=public
REQUIRE_MIDGARD_READ_REPLICA=true
NODE_DB_POOL_MAX=8
INDEXER_DB_POOL_MAX=5
DB_CONNECTION_TIMEOUT_MS=5000
DB_IDLE_TIMEOUT_MS=30000
DB_STATEMENT_TIMEOUT_MS=10000
API_RATE_LIMIT_MAX=120
API_RATE_LIMIT_WINDOW_MS=60000
RESPONSE_CACHE_MAX_ENTRIES=1000
```

`POSTGRES_URL` remains the local-development fallback. Setting
`REQUIRE_MIDGARD_READ_REPLICA=true` makes a production boot fail rather than
silently directing explorer reads to the node primary.

## Origin cache and CDN

Start the explorer-owned database and API cache:

```bash
docker compose up -d explorer-postgres explorer-api-cache
```

The proxy forwards to `host.docker.internal:3101` by default and listens on
`127.0.0.1:3102`. Override these with `BACKEND_ORIGIN` and `API_CACHE_PORT`.
Point the frontend API base at the proxy, never directly at port 3101.

The backend emits `Cache-Control` and `X-Accel-Expires` from the route catalogue.
Nginx honors those lifetimes, coalesces simultaneous misses, and bounds its
cache at 256 MiB. Errors are `no-store`; stale data is used only while another
request refreshes the same key.

For Cloudflare, Fastly, CloudFront, or another CDN:

- cache only successful `GET`/`HEAD` requests under `/api/`;
- include the full query string in the cache key;
- honor the origin's `s-maxage` and `no-store` directives;
- bypass caching for `Authorization` and `Set-Cookie`;
- preserve the original client address in `X-Forwarded-For`;
- apply a global client/origin request budget at the CDN when running multiple
  backend processes.

## PostgreSQL streaming replica

`docker-compose.replica.yml` provisions the standby, but replication must first
be authorized on the Midgard PostgreSQL primary. This is PostgreSQL operations
configuration, not a Midgard code change.

On the primary, an administrator must:

1. Enable physical replication (`wal_level=replica` and at least one WAL sender).
2. Create a login role with `REPLICATION` only.
3. Permit that role and the replica host in `pg_hba.conf`.
4. Create the physical slot named `midgard_explorer_replica`.
5. Reload PostgreSQL and keep enough WAL for the replica's expected downtime.

Use the same PostgreSQL major version as the primary. Then provide the private
replication connection settings and start the standby:

```bash
docker compose -f docker-compose.yml -f docker-compose.replica.yml \
  up -d midgard-read-replica
```

The replica volume must be empty on its first start. `pg_basebackup` writes the
standby configuration and uses the pre-created replication slot. Monitor replay
lag and WAL retention; a stopped slot can otherwise retain WAL indefinitely on
the primary.

Create a least-privilege login on the primary (which is then replicated) with
`CONNECT` and `SELECT` on the required Midgard tables. `backend/sql/explorer-reader-role.sql`
does exactly that and nothing else:

```bash
psql -h <primary-host> -U postgres -d midgard \
     -v role_password="'a-strong-password'" \
     -f backend/sql/explorer-reader-role.sql
```

It names the tables the explorer reads one by one rather than granting on the
whole schema, reports any it could not find instead of skipping it silently, and
finishes by printing what the login can do on every table in `public`. Re-run it
after a node migration adds a table the explorer needs. Use that login in
`MIDGARD_READ_REPLICA_URL`. The backend additionally enforces read-only sessions,
which is the application promising; the grants are the database enforcing.

## DA isolation

Explorer responses do not call a DA network. They read the local, retained
`da_payloads` metadata from the PostgreSQL replica. If payload blobs are exposed
in the future, serve content-addressed immutable objects through object storage
and the CDN rather than proxying reader traffic into the DA service.
