# Running the explorer against an existing Midgard database

This mode shows real Midgard records from a node database that already holds
them. It starts the explorer's own PostgreSQL, the backend and the web app. It
does not start `midgard-node`, Cardano Node, Kupo or Ogmios, and it does not
need them: L2 blocks, transactions, addresses and UTxOs are read from the node's
own tables.

Use it when a Midgard node has run somewhere and its PostgreSQL is reachable.

Two terminals. The [backend guide](../backend/README.md) and the
[frontend guide](../frontend-new/README.md) cover each package's commands in
full; this page covers the mode.

## What you need

- Node 24, pnpm 11, and Docker with the Compose v2 plugin.
- A reachable Midgard PostgreSQL, and the credentials for it.
- 3 GB of free memory, measured. See [Resource requirements](resource-requirements.md).

A deployment manifest, which says which Midgard this is and which validators it
declares. The backend refuses to boot when it is set and cannot be parsed.

## Set it up

```sh
cd backend
pnpm install
pnpm setup
```

This writes `.dev/runtime.env` at mode 0600, the one place ports, origins,
database URLs and the local database password live. It then generates
`backend/.env` from it, so no password or URL is copied between files by hand.
It writes nothing outside this package.

A file that already exists is not replaced. Setup reports any setting that
disagrees with `.dev/runtime.env` and leaves the file alone; `pnpm setup --force`
regenerates it, copying the current one to `.backup` first.

An index that already works is described rather than redefined: an existing
password and host are carried into `.dev/runtime.env` rather than regenerated,
because a new password locks an initialised PostgreSQL volume out of every
client.

Fill the node's own connection details in `backend/.env`, then run `pnpm setup`
again to carry them across:

```text
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DB=midgard
```

The test suite needs no database prepared for it. Each database-backed test
creates a throwaway on the server `POSTGRES_URL` names, applies the node schema
fixture, and drops it again. Only a database marked as a throwaway is ever
dropped.

## Start it

```sh
cd backend
pnpm doctor
pnpm dev
```

```text
API:       http://127.0.0.1:3101
Mode:      serving L2 reads
Frontend:  cd ../frontend-new && pnpm dev
```

`pnpm dev` checks that it can serve, then runs the API in the foreground. It
starts no container: the explorer reads Midgard's database and owns none of its
own. In the second terminal:

```sh
cd frontend-new
pnpm install
pnpm dev
```

The web app serves <http://127.0.0.1:3011> and calls the backend directly. It
refuses to start when the API is not answering, so a missing first terminal is
reported rather than rendered as an error on every page.

## Ports

This mode does not choose ports. Its ports are coordinated with services this
repository does not own, and `NEXT_PUBLIC_API_BASE` is read at build time, so a
silently reassigned port produces a frontend calling an origin nothing is
listening on.

A conflict is reported and the run stops. Change the port in `.dev/runtime.env`
and re-run `pnpm setup --force`:

```text
BACKEND_PORT=3101
API_CACHE_PORT=3102
FRONTEND_PORT=3011
```

The API cache on 3102 belongs to the deployed shape, not to development. Nothing
here starts it: the frontend calls the backend on 3101, and the API answers the
same records either way.

## Two readiness questions

`GET /readyz` is the deployment gate. It asks whether this build can serve
everything: the node database, the index schema, a completed Cardano
reconciliation, and a readable deployment manifest. Nothing about it changes in
this mode, and an index that has never indexed answers 503.

The L2 scope is narrower and exists on the command line only:

```sh
cd backend && pnpm readiness
```

It asks whether the node's database can answer the queries the read path makes
and whether the deployment manifest parses. This is what `pnpm dev` waits for,
and it is the same answer a deployment gates on.

## What the Cardano pages show

The Cardano pages are built from what the Midgard node recorded: the commitment
transaction it submitted for each block, and the deposits, withdrawals and
forced-transaction orders it read. `/api/l1/activity/1` is that list and
`/api/l1/activity/summary` counts it by kind.

Nothing here observes Cardano. A transaction no Midgard record names does not
appear, no hash is presented as confirmed, and each page says so rather than
implying otherwise. The explorer kept its own Cardano index until 2026-09-18;
[ADR 0009](decisions/0009-node-reported-settlement.md) records why it was
decommissioned and what was given up with it.

When a check fails, diagnose it with:

```sh
cd backend && pnpm doctor
```

See [Troubleshooting](troubleshooting.md).

## Stopping

Ctrl-C in each terminal stops that process. `pnpm dev` starts no container, so
there is usually nothing left to stop:

```sh
cd backend && pnpm services:down
```

That stops only what this package started. It removes no volume, no database and
no Midgard state.
