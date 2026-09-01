# Running the explorer against an existing Midgard database

For everyday work, the two package commands are shorter and put each log in
its own terminal: see the [backend guide](../backend/README.md) and the
[frontend guide](../frontend-new/README.md). This page covers `./dev up
existing`, which runs the whole stack from one terminal and puts the
production API cache in front of the backend.

This mode shows real Midgard records from a node database that already holds
them. It starts the explorer's own PostgreSQL, the API cache, the backend and
the web app. It does not start `midgard-node`, Cardano Node, Kupo or Ogmios, and
it does not need them: L2 blocks, transactions, addresses and UTxOs are read
from the node's own tables.

Use it when a Midgard node has run somewhere and its PostgreSQL is reachable.

## What you need

- Node 24, pnpm 11, and Docker with the Compose v2 plugin.
- A reachable Midgard PostgreSQL, and the credentials for it.
- 3 GB of free memory, measured. See [Resource requirements](resource-requirements.md).

Indexing Cardano additionally needs a deployment manifest and a Koios URL. That
is the second half of this page.

## Set it up

```sh
./dev setup existing
```

This writes `.dev/runtime.env` at mode 0600, the one place ports, origins,
database URLs and the local database password live. It then generates
`backend/.env` and `frontend-new/app/.env.local` from it, so no password or URL
is copied between files by hand.

A file that already exists is not replaced. Setup reports any setting that
disagrees with `.dev/runtime.env` and leaves the file alone;
`./dev setup existing --force` regenerates it, copying the current one to
`.backup` first.

An index that already works is described rather than redefined: an existing
password and host are carried into `.dev/runtime.env` rather than regenerated,
because a new password locks an initialised PostgreSQL volume out of every
client.

Fill the node's own connection details in `.dev/runtime.env` if setup could not
find them, then re-run with `--force`:

```text
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DB=midgard
```

Then create the disposable database the test suite uses:

```sh
./dev setup test
```

This creates the database and applies the index migrations to it. It refuses any
target whose name does not end in `_test` or whose host is not this machine,
because the suite truncates whatever it names.

## Start it

```sh
./dev doctor existing
./dev up existing
```

```text
Explorer:  http://127.0.0.1:3011
API:       http://127.0.0.1:3102
Status:    serving L2 reads
Mode:      existing Midgard database
```

`up` starts the two containers, applies the index migrations, starts the
backend with the Cardano indexer off, checks that it can serve L2 reads, then
starts the web app and waits for the overview page.

## Ports

This mode does not choose ports. Its ports are coordinated with services this
repository does not own, and `NEXT_PUBLIC_API_BASE` is read at build time, so a
silently reassigned port produces a frontend calling an origin nothing is
listening on.

A conflict is reported and the run stops. Change the port in `.dev/runtime.env`
and re-run `./dev setup existing --force`:

```text
BACKEND_PORT=3101
API_CACHE_PORT=3102
FRONTEND_PORT=3011
```

## Two readiness questions

`GET /readyz` is the deployment gate. It asks whether this build can serve
everything: the node database, the index schema, a completed Cardano
reconciliation, and a readable deployment manifest. Nothing about it changes in
this mode, and an index that has never indexed answers 503.

The L2 scope is narrower and exists on the command line only:

```sh
cd backend && pnpm readiness -- --scope=l2
```

It asks whether L2 blocks, transactions, addresses and UTxOs can be served. It
skips the Cardano reconciliation, which is a network-dependent pass against
Koios, and it skips the manifest, which describes the L1 contracts. This is what
`./dev up existing` waits for, and it is not a deployment gate.

## What the Cardano pages show

With the indexer off, the L1 list routes still answer, with whatever the index
already holds. The pages say which case they are in rather than guessing:

| Index state | The page says |
|---|---|
| `unbuilt` | The Cardano index has not been built |
| `indexing` | The index is still being built, and names every cursor height |
| `reconciled` | No Cardano activity in this range, the chain being quiet |

`/api/l1/summary` carries that state and all three cursor heights.

## Indexing Cardano as well

```sh
./dev up existing --with-l1-sync
```

This needs two more settings, checked before anything starts:

- `MIDGARD_MANIFEST_PATH` must name a file that exists. A Midgard deployment has
  no on-chain identifier, so the manifest is the only thing that says which
  contracts to follow. Indexing without it produces rows attributed to nothing,
  which no query reaches. This is also the only mode that needs it: without
  `--with-l1-sync` the explorer reads L2 records and never opens the manifest,
  so the setting may be left blank.
- `KOIOS_BASE_URL` must be set.

The path this run checked is the one the backend reads, so a `.dev/runtime.env`
and a `backend/.env` that disagree fail here, naming the file, rather than at
boot.

Exactly one indexer runs. The index is written by one process and read by all of
them, and the writer takes an advisory lock, so a second would not index while
appearing to.

The command then waits for strict readiness, printing the cursors as they move:

```sh
./dev status --watch
```

No cursor value is ever written by these commands. A cursor is written only
inside a pass where every source completed, which is what makes the three
heights a record of a finished reconciliation rather than a progress bar.

If reconciliation doesn't finish, diagnose it with the same flag:

```sh
./dev doctor existing --with-l1-sync
```

Without the flag, doctor asks whether the explorer can serve L2 records, which
it can while the Cardano index is still behind. See
[Troubleshooting](troubleshooting.md).

How long the wait is depends on the gap between the index and the chain tip, and
on the network. It is not bounded by anything in this repository.

## Stopping

```sh
./dev down
```

This stops the backend, the web app, and the two containers. It removes no
volume, no database and no Midgard state. The index survives every run.
