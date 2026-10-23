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

It checks the toolchain and the configuration, checks that the Midgard node's
database can answer the queries the read path makes, and then runs the API in
the foreground on <http://127.0.0.1:3101>.

It starts no container. The explorer owns no database: it reads Midgard's,
which this repository does not provision.

Ctrl-C stops the API.

## Indexing Cardano

Not any more. The explorer kept its own Cardano index until 2026-09-18, started
with a `dev:l1` command; [ADR 0009](../docs/decisions/0009-node-reported-settlement.md)
records why it was decommissioned and what the explorer gave up with it. The
Cardano pages are built from what the Midgard node itself recorded, so there is
nothing to index and nothing to reach Koios for.

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

The database-backed tests need `REQUIRE_DB=1` and a PostgreSQL server they may
create databases on, which is the one `POSTGRES_URL` names:

```sh
REQUIRE_DB=1 pnpm test
```

Each such test creates its own throwaway database, applies the node schema
fixture to it, and drops it afterwards. Nothing is truncated, and no database
that is not marked as a throwaway is ever dropped.

## Build for production

```sh
pnpm build      # tsc, emits dist/
pnpm start      # node dist/index.js
```

Production runs compiled JavaScript, not `ts-node`.

## Commands

| Command | What it does |
|---|---|
| `pnpm setup` | Writes `backend/.env`. Starts nothing. |
| `pnpm doctor` | Reports what is wrong and the command that fixes it. |
| `pnpm dev` | The API, in the foreground, against an existing Midgard database. |
| `pnpm status` | Whether the API answers, and which database it is configured to read. |
| `pnpm services:down` | Stops the containers this package started. |
| `pnpm check` | Typecheck, the documentation gate, and both suites. |
| `pnpm compat` | Reads, checks or rewrites the node schema pin in `config/midgard-compatibility.json`. |
| `pnpm docs:check` | Every documented command exists and every repository link resolves. |
| `pnpm build` / `pnpm start` | Compile, then run the compiled server. |
| `pnpm dev:server` | The server alone, with no lifecycle around it. |
| `pnpm readiness` | The readiness probes, without starting a server. |

## Configuration

`backend/.env` is what this package reads. `backend/.env.example` documents
every setting, including which database an L2 figure comes from.

The ones you have to supply:

| Setting | What it names |
|---|---|
| `POSTGRES_URL` | The Midgard node's own database, read-only |
| `MIDGARD_MANIFEST_PATH` | The deployment manifest: which Midgard this is, and which validators it declares |

## What the commands will not do

- **Write to any database.** The Midgard node's is opened read-only, and this
  package owns none of its own.
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
to use before sending traffic. It has one scope: there were two while the
explorer kept a Cardano index of its own, and a `--scope=` flag is now refused
rather than silently accepted.
