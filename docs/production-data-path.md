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
      |
      v
Midgard PostgreSQL replica
(read-only, every page)
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

Start the API cache:

```bash
docker compose up -d explorer-api-cache
```

The Compose file also carries `explorer-postgres`, which held the explorer's own
Cardano index. That index is decommissioned and nothing reads the database; it
is kept, stopped, so the decision can be reversed. See
[ADR 0009](decisions/0009-node-reported-settlement.md).

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

The frontend's host must compress JSON as well. `next start` compresses pages
but not route handlers, so `/api/overview`, which the home page polls every
ten seconds, leaves the Next server uncompressed. Vercel's CDN compresses the
content types on its allowlist automatically; after deploying, confirm the
route answers with `Content-Encoding: gzip` or `br`. A self-hosted `next start`
needs a compressing proxy in front of it.

## Metrics

Set `METRICS_PORT` to serve Prometheus metrics at `/metrics` on a separate
listener. It binds `127.0.0.1` unless `METRICS_HOST` names another address, and
it refuses to share `BACKEND_PORT`. The edge proxy never forwards it. Do not
publish this port: it describes the process, not the chain.

| Metric | Labels | What it answers |
|---|---|---|
| `explorer_http_request_duration_seconds` | `route`, `method`, `status_class` | Route latency, per route template |
| `explorer_route_statements_per_request` | `route` | The statement count the route budgets judge, per request |
| `explorer_db_statement_duration_seconds` | `database` (`node`), `class` | Time per statement, by the work it belongs to |
| `explorer_response_cache_total` | `route`, `result` (`hit`, `miss`, `bypass`) | How often the in-process cache answers |
| `explorer_web_vitals_lcp_seconds`, `_inp_seconds`, `explorer_web_vitals_cls` | `route_class`, `device_class` | Web Vitals the explorer's pages report through `POST /api/vitals` |
| `process_resident_memory_bytes`, `nodejs_*` | none | Memory, heap, event-loop lag and garbage collection |

`route` is always a template such as `/api/blocks/:page`, never the path a
client sent, so walking every block adds no series. A request no route matched
is labelled `unmatched`. Statement counts leave out `BEGIN` and `COMMIT`, the
same rule the benchmark uses.

Pages send LCP, INP and CLS with `navigator.sendBeacon` in production builds.
The browser only sends them when the page and the API share an origin, which the
page's `connect-src 'self'` policy already requires of every browser request.
Anyone can post a sample. Every field is a closed set or a bounded range, so a
forged sample can skew a figure but cannot add a series, and the per-client
rate limit applies. Read the figures as indicative, not audited.

Each Web Vitals budget threshold is a bucket boundary, so the share of samples
inside the LCP budget over 28 days, per cell, is a ratio of counts:

```promql
sum by (route_class, device_class) (increase(explorer_web_vitals_lcp_seconds_bucket{le="2.5"}[28d]))
  / sum by (route_class, device_class) (increase(explorer_web_vitals_lcp_seconds_count[28d]))
```

The budget passes a cell when that share is at least 0.75 over at least 1,000
samples. Prometheus must retain 28 days for the window to exist.

A scrape job on the same host, with `METRICS_PORT=9464`:

```yaml
scrape_configs:
  - job_name: midgard-explorer
    static_configs:
      - targets: ["127.0.0.1:9464"]
```

## Readiness, and what each answer gates

| Route | Answers | Gates |
|---|---|---|
| `/healthz` | the process is alive | restarts |
| `/readyz` | the explorer can serve | routing, and a deployment |

One scope. There were three while the explorer kept its own Cardano index, so
that an index behind the tip could degrade the Cardano surface without making a
Midgard page unavailable. The index is decommissioned, every page reads the node,
and `/readyz/l1` and `/readyz/full` answer `404` rather than answering this
question under an L1 name.

`backend/scripts/probe-readiness.ts` answers the same question without starting
a server. It takes no `--scope` flag and refuses one, rather than accepting the
name of a scope it no longer honours.

## Deployment identity

A response says which deployment it describes, and says how much of that is
known: `configured` means the manifest names it and nothing checked the claim.
There is no stronger state. The explorer-owned index used to record a binding on
first sight and refuse a manifest that disagreed, which is what `verified` meant;
the index is decommissioned and that check went with it.

The L2 database persists no protocol deployment identity of its own, only a
migration-bundle hash, so the manifest records an operator's assertion rather
than something the explorer can derive. No surface may present it as verified.

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

`explorer_reader` still inherits anything this database grants to `PUBLIC`,
because every role is a member of it. Closing that is a database-wide privilege
change affecting the node's own login too, so it lives in
`backend/sql/explorer-reader-revoke-public.sql` and is run deliberately, after
checking which roles depend on those grants. The file names the query to run
first.
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
