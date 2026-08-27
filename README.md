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
- `GET /readyz` reports whether both databases can serve a request, and answers
  `503` naming the one that cannot. Use it to take an instance out of rotation.
  The failing driver message goes to the log, never to the response.

## Checks

```bash
cd backend       && pnpm typecheck && pnpm test && pnpm build
cd frontend-new  && ./scripts/ci-local.sh          # add --fast to skip the e2e suite
```

`.github/workflows/ci.yml` runs the same commands on every push and pull
request, against a PostgreSQL service, and boots the compiled backend to prove
the artifact starts.

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
