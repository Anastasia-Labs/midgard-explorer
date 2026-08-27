# Midgard Explorer

This repository contains the backend and frontend for the Midgard explorer.

The explorer reads a Midgard node's PostgreSQL database and shows L2 blocks and
transactions, each transaction's lifecycle status (committed, pending commit,
accepted, rejected, validating, or queued), address balances and UTxOs, and per
block its data-availability payload metadata (Merkle roots and event counts) and
finalization status. It also lists deposits (L1 to L2), withdrawals (L2 to L1),
and forced transactions.

## Prerequisites

Before starting the explorer, you need the following services from the
[Midgard repository](https://github.com/Anastasia-Labs/midgard) running locally:

- `midgard-node`
- PostgreSQL

[Running Midgard locally](docs/running-midgard-locally.md) walks through the full
setup from a clean machine. A node database created before 2026-07-07 cannot be
reused: the schema changed and the migration refuses to run in place, so a fresh
deployment is required. The explorer expects to connect to the Postgres instance
started there.

You also need:

- Node.js 24 (see `backend/package.json` engines)
- pnpm 11

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | The API. Reads the Midgard node's Postgres and the explorer's own L1 index, and runs the Cardano L1 indexer. |
| `frontend-new/` | The current explorer web app: a pnpm workspace of `app` (Next.js), `contracts` (response schemas) and `ui` (design tokens and primitives). |
| `frontend/` | The previous Vite client. Kept and still buildable; no longer the app being developed. |
| `docs/` | Production data path, data-coverage audit, design audits, and the feedback implementation plan. |
| `infra/` | The Nginx API cache template used by `docker-compose.yml`. |

## Environment files

Create local environment files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend-new/app/.env.example frontend-new/app/.env.local
```

### `backend/.env`

The backend reads its configuration from `backend/.env`, and validates every
value at boot. A missing or empty setting stops the process with the names of
everything that is wrong, rather than becoming `undefined` or `NaN` inside a
query.

Important values:

- `BACKEND_PORT`: port the API listens on. The default is `3101`.
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
  `POSTGRES_DB`, `POSTGRES_URL`: the Midgard node's Postgres. Read only. Check
  which database this is before believing any L2 figure; `.env.example`
  explains why at length.
- `MIDGARD_READ_REPLICA_URL`, `REQUIRE_MIDGARD_READ_REPLICA`: the production
  read path. Set the replica and require it so a production boot fails rather
  than quietly sending explorer traffic to the node's primary.
- `INDEXER_POSTGRES_URL`: the Postgres the explorer owns, holding everything it
  observed on Cardano. `TEST_INDEXER_POSTGRES_URL` is the database the test
  suite truncates; it must be a different database whose name ends in `_test`.
- `MIDGARD_MANIFEST_PATH`: the deployment manifest the L1 indexer reads. A
  Midgard deployment has no on-chain identifier, so the manifest is the only way
  to know which contracts to follow.
- `L1_SYNC_ENABLED`: whether this process runs the indexing loop. Leave it true
  for a single-process deployment. A second API instance sets it false and
  serves reads only, because two loops against one index duplicate every Koios
  request and race each other's writes.
- `LOG_LOCATION`: prefix for the rotated log files.

### `frontend-new/app/.env.local`

- `NEXT_PUBLIC_API_BASE`: the API origin the browser calls. The default is the
  bundled reverse proxy on `http://localhost:3102`, not the backend itself, so
  public traffic gets shared caching.
- `API_BASE_SERVER`: the origin server components call. Falls back to the public
  base.
- `NEXT_PUBLIC_NETWORK_LABEL`, `NEXT_PUBLIC_L1_EXPLORER_TX_URL`,
  `NEXT_PUBLIC_L1_EXPLORER_NAME`: the network name shown in the shell, and the
  external Cardano explorer that L1 hashes link out to. The URL is a template
  containing `{hash}`, because explorers differ in more than their host.

## Install dependencies

```bash
cd backend && pnpm install
cd ../frontend-new && pnpm install
```

## Databases

The node's Postgres comes from the Midgard setup. The explorer's own database
and the API cache come from this repository:

```bash
docker compose up -d explorer-postgres explorer-api-cache
cd backend
pnpm indexer:deploy    # apply the L1 index migrations
```

The test database needs the same migrations applied separately, because
`indexer:deploy` targets `INDEXER_POSTGRES_URL` only:

```bash
INDEXER_POSTGRES_URL="$TEST_INDEXER_POSTGRES_URL" pnpm indexer:deploy
```

## Run the explorer

Once `midgard-node` and Postgres are running, start the backend:

```bash
cd backend
pnpm dev
```

Then, in a second terminal, start the frontend:

```bash
cd frontend-new
pnpm dev
```

## Run it in production

The backend runs as compiled JavaScript rather than through `ts-node`:

```bash
cd backend
pnpm build     # tsc -p tsconfig.build.json, emits dist/
pnpm start     # node dist/index.js
```

The frontend builds and serves with Next:

```bash
cd frontend-new
pnpm build
pnpm start
```

Two probes answer separate questions, and a deployment should use both:

- `GET /healthz` reports that the process is alive. It touches no database, so
  it is safe to restart on.
- `GET /readyz` reports whether the explorer can actually serve. It checks that
  each database holds the relations its query path uses, that the index's
  migrations finished, and that the deployment manifest parses, then answers
  `503` naming the check that failed. Use it to take an instance out of
  rotation. The failing driver message goes to the log, never to the response.

  It used to be `SELECT 1` against each database, which reports ready for an
  empty PostgreSQL that holds none of the tables. That is what CI provisioned,
  so the boot check called it healthy while the suite would have failed on a
  missing relation. It also counted only unfinished rows in `_prisma_migrations`,
  and a migration that was never applied has no row there, so a schema one
  migration behind this build answered ready.

`backend/scripts/probe-readiness.ts` runs the same checks without starting a
server, which is what to use before sending traffic:

```bash
cd backend && npx ts-node scripts/probe-readiness.ts
```

### Rolling out an indexer change

The index is written by exactly one process and read by all of them, so the
order matters. Applying the migration on its own is not a rollout: the old
binary keeps writing under the old rules against the new schema.

`backend/scripts/rollout.sh --check` prints the current state and readiness
without changing anything, and exits with readiness's own exit code, so it can
be gated on. `--apply` performs step 2. Both read their target from
`INDEXER_POSTGRES_URL`, the same variable `pnpm indexer:deploy` migrates
through, so the database being inspected and the database being migrated cannot
be two different databases. `--apply` TAKES the indexer's advisory leadership
lock and holds it across the migration, on a session that is idle rather than
sleeping, so it is released the instant the script ends or is killed. Checking
that the lock was free and then migrating would only have proved it was free at
one instant: the checking connection closes, releases, and a supervised writer
can restart into the gap. A writer that restarts now finds the lock held and
does not index. Stopping the supervisor is still a precondition, because the
lock stops a restarted writer from indexing, not from starting.

It asks for the full `host:port/database` rather than the database name, which
on its own cannot tell two hosts apart. It does not start or stop writers,
because it cannot know what supervises them.

1. **Stop the current writer.** Set `L1_SYNC_ENABLED=false` and restart it, or
   stop the process. The advisory lock refuses a second writer, so a new
   instance started first will simply not index.
2. **Deploy the new binary and its migration together.** `pnpm build`, then
   `pnpm indexer:deploy`. Readiness fails until both have happened, which is the
   point: an instance holding one without the other reports `503` rather than
   serving.
3. **Start exactly one indexer.** Every other instance runs with
   `L1_SYNC_ENABLED=false` and serves reads.
4. **Wait for the reindex to finish and every source to complete.** A pass that
   reconciles logs the counts it wrote; a pass that could not logs
   `additive only: a source did not complete`. Do not open traffic on those:
   the reorg window has not been reconciled. The three cursors (`l1`,
   `l1:mints`, `l1:rewards`) sit at the same height once a pass has reconciled.

   Readiness answers this for you and keeps the instance out of rotation until
   it is true. It refuses an index holding rows under `default`, and cursors
   that are not all past zero AND equal. Each half is needed. The migration
   leaves all three reading zero, so equality alone passes the worst moment;
   and three different non-zero heights mean three different passes covering
   three different windows, so every mint between the mint cursor and the
   primary one is missing while the row counts look healthy. A cursor is
   written only inside a pass where every source completed, which is what makes
   the pair a record of a completed reconciliation rather than a progress bar.
5. **Validate the queries before opening traffic.** Every event must carry the
   manifest's identity and never a shared constant:

   ```sql
   SELECT deployment, count(*) FROM l1_event GROUP BY deployment;
   ```

   One row, whose deployment is the manifest's `manifestId`. A `default` row
   means rows were written before the attribution repair and are unreachable by
   any query the UI makes.

## Checks

```bash
cd backend       && pnpm typecheck && pnpm run audit:gate && pnpm test && pnpm build
cd frontend-new  && ./scripts/ci-local.sh          # add --fast to skip the e2e suite
```

`REQUIRE_DB=1` makes the database-backed backend tests fail rather than skip.
Set it anywhere the result is being used as a gate; without it a run with no
database reachable reports success having tested very little.

`pnpm run audit:gate` fails on any production advisory with no recorded
disposition in `backend/security-advisories.json`, and passes one that has a
written reason. It also fails when the audit could not be produced at all: a
missing `pnpm`, an empty report, a parse failure and an unrecognised shape were
all read as zero advisories, so the gate reported success without running.

The name is `audit:gate` rather than `audit` because `pnpm audit` is pnpm's own
command and takes precedence over a script of the same name.

`.github/workflows/ci.yml` runs the same commands on every push and pull
request, against a PostgreSQL service carrying both the explorer's own
migrations and a versioned fixture of the node's schema
(`backend/test/fixtures/schema/midgard-node.sql`, generated from
`prisma/schema.prisma`), and boots the compiled backend to prove the artifact
starts. Both jobs upload what they printed as an artifact, on success as well
as failure, so a green run's counts can be read by anyone with access to it.
Container images are pinned by digest and actions by commit SHA, and the
workflow token is `contents: read`.

`docs/release/l1-attribution-repair.md` is the release record for the
attribution repair: identities, commands, counts, representative transactions
and what remains unproven.

### Deployment configuration

`MG_STRICT_CONFIG=1` makes the frontend build refuse to produce an artifact
that is not deployable: it requires `NEXT_PUBLIC_NETWORK_LABEL`,
`NEXT_PUBLIC_L1_EXPLORER_TX_URL`, `NEXT_PUBLIC_SITE_URL`, `API_BASE_SERVER`,
and a `NEXT_PUBLIC_API_BASE` a visitor can actually reach. That last one
defaulted to `http://localhost:3102`, so a build without it published API
documentation and copyable examples pointing at each visitor's own machine.

`TRUSTED_PROXY_MODE` decides whether the backend reads `x-forwarded-for` at
all. It defaults to `none`, meaning the socket peer is the client identity and
the header is ignored whoever sent it. Set `single-edge` only when the backend
sits directly behind the bundled nginx edge, which replaces the chain with the
address it saw rather than appending to it.

`TRUSTED_PROXY_PEERS` then names that edge, as exact addresses or IPv4 CIDR
blocks. It is required in `single-edge` mode, because trust used to be granted
to any peer in a private range: anything that could reach the port from inside
the network could present itself as the edge and state any client identity it
liked.

On a machine too small to hold the whole end-to-end suite in one process,
`frontend-new/scripts/e2e-by-file.sh` runs the same tests one spec file at a
time against a single production build, and reports per file.

## Production data path

Production deployments should put the bundled Nginx cache (and optionally a
CDN) in front of the backend and point Midgard reads at a PostgreSQL streaming
replica. The explorer-owned L1 index remains in its separate database. Pool
limits, statement timeouts, shared-cache headers, and one aggregate `/api`
request budget are configured by the backend.

See [Production explorer data path](docs/production-data-path.md) for the exact
environment variables, reverse-proxy deployment, replica prerequisites, and
failure-safety rules.
