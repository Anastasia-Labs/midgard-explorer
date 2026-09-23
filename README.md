# Midgard Explorer

The explorer reads a Midgard node's PostgreSQL database and shows L2 blocks and
transactions, each transaction's lifecycle status (committed, pending commit,
accepted, rejected, validating, or queued), address balances and UTxOs, and per
block its data-availability payload metadata (Merkle roots and event counts) and
finalization status. It also lists deposits (L1 to L2), withdrawals (L2 to L1),
and forced transactions.

## Before you start

- Node.js 24, the version `.nvmrc` pins and continuous integration runs.
- pnpm 11, from `corepack enable`.
- Docker with the Compose v2 plugin. The explorer's own PostgreSQL runs in it.
- A reachable Midgard node PostgreSQL. That is the only thing this repository
  cannot provide for you.

## Start it

Two terminals. The backend serves the API, the frontend serves the pages, and
each one's log is its own terminal's output.

```sh
cd backend
pnpm install
pnpm setup      # writes backend/.env, then lists what you must fill in
pnpm dev
```

```sh
cd frontend-new
pnpm install
pnpm dev
```

Open <http://127.0.0.1:3011>.

`pnpm dev` in `backend/` starts the explorer's own PostgreSQL, applies the index
migrations, checks both databases, and then runs the API on
<http://127.0.0.1:3101>. Ctrl-C stops the API and leaves the containers running;
`pnpm services:down` stops those.

## Start it without a Midgard node

One terminal, no backend, no Docker, no database and no secrets. The records are
committed fixtures, and the interface says so.

```sh
cd frontend-new
pnpm install
pnpm dev:demo
```

## When something is wrong

```sh
cd backend && pnpm doctor
```

It names the check that failed and the command that fixes it.
[Troubleshooting](docs/troubleshooting.md) is organised by those same names.

## Guides

| Guide | What it covers |
|---|---|
| [Backend](backend/README.md) | Every backend command, its configuration, and the database-safety rules |
| [Frontend](frontend-new/README.md) | Every frontend command, the demo mode, and the end-to-end suite |
| [Running the full Midgard stack](docs/running-full-midgard.md) | Producing live L2 activity, by hand: Cardano Node, Kupo, Ogmios and funded wallets |
| [Troubleshooting](docs/troubleshooting.md) | Keyed by the names `pnpm doctor` prints |
| [Resource requirements](docs/resource-requirements.md) | Measured memory floors per mode |

[ADR 5](docs/decisions/0005-pnpm-is-the-development-interface.md) records why
these are the only commands: every service belongs to the package that runs it,
so there is one way to start the explorer rather than two that must agree.

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | The API. Reads the Midgard node's PostgreSQL, and nothing else. |
| `frontend-new/` | The current explorer web app: a pnpm workspace of `app` (Next.js), `contracts` (response schemas) and `ui` (design tokens and primitives). |
| `frontend/` | The previous Vite client. Kept and still buildable; no longer the app being developed. |
| `docs/` | Production data path, data-coverage audit, design audits, and the feedback implementation plan. |
| `docs/decisions/` | Numbered records of structural decisions, including why each root is its own pnpm workspace. |
| `infra/` | The Nginx API cache template used by `docker-compose.yml`. |

## Configuration

`pnpm setup` in `backend/` writes `.dev/runtime.env`, the one place ports,
origins, database URLs and the local database password live, then generates
`backend/.env` from it. Nothing is copied between files by hand, and
`pnpm doctor` reports it when the two drift apart.

It writes nothing outside `backend/`. The frontend needs no generated file: it
calls <http://127.0.0.1:3101> unless `NEXT_PUBLIC_API_BASE` says otherwise.

`backend/.env.example` documents the backend's settings at length, including
which database an L2 figure came from and why that matters.

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

Two probes answer separate questions, and a deployment should use them
according to what it is routing:

- `GET /healthz` reports that the process is alive. It touches no database, so
  it is safe to restart on.
- `GET /readyz` reports whether the explorer can serve: the Midgard node's
  database, which every page reads, and the deployment manifest, which is how a
  response says which Midgard it describes.
  There were two more, `/readyz/l1` and `/readyz/full`, for the explorer-owned
  Cardano index. That index is decommissioned and they answer `404` rather than
  answering the L2 question under an L1 name.

  Each answers `503` naming the check that failed, and the failing driver
  message goes to the log, never to the response.

  `/readyz` used to include the index, its reconciliation and the manifest, and
  its verdict is `checks.every(ok)`. So an index that had never reconciled took
  the whole instance out of rotation, every L2 route with it, which contradicts
  the rule the explorer is built on: an index behind the tip degrades the
  Cardano surface and never makes a Midgard page unavailable. The index probe
  moved out with the rest, because the L2 query surface does not read the index
  and keeping it would have moved the outage rather than removed it.

  It used to be `SELECT 1` against each database, which reports ready for an
  empty PostgreSQL that holds none of the tables. That is what CI provisioned,
  so the boot check called it healthy while the suite would have failed on a
  missing relation. It also counted only unfinished rows in `_prisma_migrations`,
  and a migration that was never applied has no row there, so a schema one
  migration behind this build answered ready.

`backend/scripts/probe-readiness.ts` runs the same checks without starting a
server, which is what to use before sending traffic:

```bash
cd backend && pnpm readiness
```

### What the explorer reads

One database: the Midgard node's, read-only. The explorer kept a Cardano index
of its own until 2026-09-18, written by exactly one process and rolled out in a
fixed order; [ADR 0009](docs/decisions/0009-node-reported-settlement.md) records
why it was decommissioned and what the explorer gave up with it. Its database,
schema and migrations are retained, stopped, so the decision can be reversed.

The Cardano pages are built from what the node itself recorded: the commitment
transaction it submitted for each block, and the deposits, withdrawals and
forced-transaction orders it read. Nothing observes Cardano, so no page presents
a hash as confirmed, and a Cardano transaction no Midgard record names does not
appear at all.

## Checks

```bash
cd backend       && pnpm check && pnpm run audit:gate && pnpm build
cd frontend-new  && ./scripts/ci-local.sh          # add --fast to skip the e2e suite
```

`pnpm check` in `backend/` is the type check, the documentation gate, the Vitest
suite and the development-command tests.

The database-backed tests need no preparation: each one creates a throwaway
database on the server `POSTGRES_URL` names, applies the node schema fixture to
it, and drops it again. A throwaway is refused unless its name marks it as one.

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
starts. Every job uploads what it printed as an artifact, on success as well
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
replica. Pool limits, statement timeouts, shared-cache headers, and one aggregate `/api`
request budget are configured by the backend.

See [Production explorer data path](docs/production-data-path.md) for the exact
environment variables, reverse-proxy deployment, replica prerequisites, and
failure-safety rules.
