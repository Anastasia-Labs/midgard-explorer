# Midgard Explorer backend

The API. It reads a Midgard node's PostgreSQL for L2 records, keeps its own
PostgreSQL index of Cardano L1 activity, and serves both to the explorer.

Every command below runs in this directory.

## Before you start

- Node.js 24 and pnpm 11, from `corepack enable`.
- Docker with the Compose v2 plugin. The explorer's own PostgreSQL runs in it.
- A reachable Midgard node PostgreSQL, with its host, port, user, password and
  database name to hand.

## Set it up

```sh
pnpm install
pnpm setup
```

`pnpm install` generates both Prisma clients, so there is nothing to run by
hand afterwards.

`pnpm setup` writes `backend/.env` and generates a password for the explorer's
own database. It starts nothing, and it never overwrites a password an existing
database was initialised with. It ends by printing the values you have to
supply: the Midgard node's connection settings, which nothing can invent.

Fill `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and
`POSTGRES_DB` in `backend/.env`, then run `pnpm setup` again. That file is what
this package reads; `.dev/runtime.env` is internal state that setup keeps in
step with it.

## Start it

```sh
pnpm dev
```

It checks the toolchain and the configuration, starts the explorer's own
PostgreSQL, refuses to migrate anything that is not that database, applies the
index migrations, checks that both databases can answer the queries the read
path makes, and then runs the API in the foreground on
<http://127.0.0.1:3101>.

Ctrl-C stops the API. The containers keep running, because they hold the index
and the next `pnpm dev` adopts them.

## Index Cardano as well

```sh
pnpm dev:l1
```

The same lifecycle, plus the L1 indexer. It needs two more things, checked
before anything starts:

- `MIDGARD_MANIFEST_PATH` must name a readable file. A Midgard deployment has
  no on-chain identifier, so the manifest is the only thing that says which
  contracts to follow. Indexing without it produces rows attributed to nothing,
  which no query reaches.
- `KOIOS_BASE_URL` must be set.

Reconciliation reaches Koios over the network and takes as long as the gap is
wide. `pnpm status` reports where the cursors are.

## Check what is wrong

```sh
pnpm doctor                    # can this serve L2 records?
pnpm doctor --with-l1-sync     # and could it take traffic?
pnpm doctor full               # could this machine host a full Midgard stack?
pnpm doctor --json             # the same report, for a script
```

Without the flag it asks the narrower question, which is the right one while
the Cardano index is still behind. [Troubleshooting](../docs/troubleshooting.md)
is organised by the names it prints.

## Stop the containers

```sh
pnpm services:down
```

It stops only what `pnpm dev` started. A container that was already running
when `pnpm dev` first looked is left alone, and the message says so. No volume,
database or Midgard state is removed by any command in this package.

## Run the checks

```sh
pnpm check          # typecheck, the documentation gate, and both suites
pnpm test           # the unit suite alone
pnpm test:dev       # the development commands' own tests
pnpm docs:check     # every documented command exists, every link resolves
pnpm audit:gate     # the dependency policy
```

The database-backed tests need `REQUIRE_DB=1` and a prepared test database:

```sh
pnpm setup:test
REQUIRE_DB=1 pnpm test
```

That database is truncated by the suite. `pnpm setup:test` refuses any target
whose name does not end in `_test` or whose host is not this machine.

## Build for production

```sh
pnpm build      # tsc, emits dist/
pnpm start      # node dist/index.js
```

Production runs compiled JavaScript, not `ts-node`.

## Commands

| Command | What it does |
|---|---|
| `pnpm setup` | Writes `backend/.env` and the local index credentials. Starts nothing. |
| `pnpm setup:test` | Creates and migrates the disposable test database. Refuses any target not named `_test`. |
| `pnpm doctor` | Reports what is wrong and the command that fixes it. |
| `pnpm dev` | The API, in the foreground, against an existing Midgard database. |
| `pnpm dev:l1` | The same, and indexes Cardano. |
| `pnpm status` | Whether the API answers, what the containers are, and where the index points. |
| `pnpm services:down` | Stops the containers this package started. |
| `pnpm check` | Typecheck, the documentation gate, and both suites. |
| `pnpm compat` | Reads, checks or rewrites the node schema pin in `config/midgard-compatibility.json`. |
| `pnpm docs:check` | Every documented command exists and every repository link resolves. |
| `pnpm build` / `pnpm start` | Compile, then run the compiled server. |
| `pnpm dev:server` | The server alone, with no lifecycle around it. |
| `pnpm readiness` | The readiness probes, without starting a server. |
| `pnpm indexer:deploy` | Applies index migrations to whatever `INDEXER_POSTGRES_URL` names. |

## Configuration

`backend/.env` is what this package reads. `backend/.env.example` documents
every setting, including which database an L2 figure comes from.

The ones you have to supply:

| Setting | What it names |
|---|---|
| `POSTGRES_URL` | The Midgard node's own database, read-only |
| `INDEXER_POSTGRES_URL` | The explorer's own index, which this package owns |
| `MIDGARD_MANIFEST_PATH` | The deployment manifest, required only when `L1_SYNC_ENABLED` is true |
| `KOIOS_BASE_URL` | Where L1 history is read from, when indexing |

## What the commands will not do

- **Migrate a database this repository does not own.** `pnpm dev` resolves the
  index URL the same way Prisma does, then checks it against the address
  `docker compose port explorer-postgres 5432` reports. Anything else is
  refused, and the message names the mismatch. Apply those by hand through
  `./scripts/rollout.sh --apply`, which holds the indexer's advisory lock
  across the migration.
- **Stop a container it did not start.** The set that was already running is
  recorded before anything starts, and before any check that could end the run.
- **Delete anything.** No command here removes a volume, a database, an MPF
  directory or an on-chain deployment.

## Readiness

Two probes answer different questions:

- `GET /healthz` reports that the process is alive. It touches no database, so
  it is safe to restart on.
- `GET /readyz` reports whether this instance can serve: that each database
  holds the relations the query path uses, that the index's migrations
  finished, that a reconciliation completed, and that the manifest parses. It
  answers `503` naming the check that failed. Use it to take an instance out of
  rotation. The failing driver message goes to the log, never to the response.

`pnpm readiness` runs the same checks without starting a server, which is what
to use before sending traffic. `pnpm readiness -- --scope=l2` asks the narrower
development question and is not a deployment gate.

Rolling out an indexer change has an order that matters; it is recorded in the
[root README](../README.md#rolling-out-an-indexer-change).
