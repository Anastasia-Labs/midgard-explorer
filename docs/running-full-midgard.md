# Running the full Midgard stack

The explorer reads a Midgard node's PostgreSQL database directly. To see live
data being produced you need a running node, which means Cardano Node, Kupo,
Ogmios, funded Preprod wallets and a deployment on chain. This page takes you
from a clean machine to an explorer showing a node you are running yourself.

This is the largest of the three modes. If a Midgard database already exists
somewhere, [Running against an existing Midgard database](running-existing-midgard.md)
reaches real records without any of the Cardano services. If you want to see the
interface, [Running on demo data](running-demo.md) needs nothing at all.

Memory for this mode has not been measured. The explorer's own share is recorded
in [Resource requirements](resource-requirements.md); the Cardano services
dominate the total and no figure is offered for them here.

## What the explorer connects to

| Piece | Where it runs | Port |
|---|---|---|
| Midgard node HTTP API | Docker (`midgard-node`) | 3000 |
| Midgard PostgreSQL | Docker (`postgres`) | host 5433, container 5432 |
| Explorer PostgreSQL | Docker (`explorer-postgres`) | host 5435, container 5432 |
| Explorer backend | `cd backend && pnpm dev:l1` | 3101 |
| Explorer web app | `cd frontend-new && pnpm dev` | 3011 |

The web app is `frontend-new/`. The explorer's ports avoid 3000, which the
node's HTTP API holds, and 3100, which the node's monitoring stack holds. The
previous Vite client in `frontend/` is kept and still buildable, but it is not
the app these steps run.

The backend needs only the PostgreSQL connection; it never calls the node's HTTP
API. The node's Docker stack exposes Postgres on host port 5433.

## Prerequisites

- Docker with the compose plugin, runnable without `sudo`.
- Node.js and pnpm matching the pins of each repo (`packageManager` in the
  respective `package.json`; the node repo pins `pnpm@9.15.4`). Use `nvm use`
  in each repo before running commands.
- The [Midgard repository](https://github.com/Anastasia-Labs/midgard) cloned as
  a sibling of this repo, on the `tx-validation` branch. The node lives in
  `demo/midgard-node`.

## Step 1: Decide between attaching and a fresh deployment

The node stores durable protocol state in two places: on-chain (Preprod, via the
deployed Midgard contracts) and locally (the Postgres volume plus MPF databases).
The node's README is explicit that the two must stay paired: wipe local state only
as part of a full clean protocol redeploy, and never combine a fresh local
database with previously deployed on-chain state (see "How to Run" in
[demo/midgard-node/README.md](https://github.com/Anastasia-Labs/midgard/blob/tx-validation/demo/midgard-node/README.md)).

Which case are you in?

- **Your local Postgres volume was created after 2026-07-07 and the node ran
  fine on it**: attach. Start the stack (Step 3) and skip the deployment work.
- **Your volume predates 2026-07-07, or this is your first run**: fresh
  deployment. The node's database schema changed on 2026-07-07 (migration files
  were renumbered and the DA payload table moved to a v2 shape that refuses
  in-place migration), so an older volume cannot be reused. Wiping it puts you
  in the "full clean protocol redeploy" case: a new hub-oracle one-shot,
  republished reference scripts, and a fresh `init`, all described in the node
  README's "How to Run" section.

## Step 2: Configure the node

```sh
cd ../midgard/demo/midgard-node
cp .env.example .env   # first run only; otherwise keep your .env
```

Points that matter for the explorer:

- `L1_PROVIDER=Kupmios` with the local Kupo/Ogmios endpoints. The demo node
  accepts only the local Kupmios stack
  (`docker-compose.kupmios.yaml`); the first start restores a Mithril snapshot
  and can take a while.
- `PORT=3000` is the node's HTTP port; the explorer does not use it, but the
  activity commands in Step 4 do.
- The Postgres credentials (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`)
  are what the explorer backend will connect with.
- Wallet seeds: the operator, merge, reference-script, and user wallets must be
  distinct and funded on Preprod. The user wallet (`USER_WALLET` /
  `USER_SEED_PHRASE`) is the one you will send L2 transfers from.

## Step 3: Start the node stack

Follow "How to Run" in the node README for the current, authoritative sequence.
The short form:

```sh
cd ../midgard/demo/midgard-node
pnpm install --frozen-lockfile
pnpm build
docker compose -f docker-compose.yaml -f docker-compose.kupmios.yaml up -d
```

Compose starts Postgres, runs the one-shot `midgard-node-migrate` service, and
starts `midgard-node` only after migration succeeds. For a fresh deployment,
complete the redeploy steps from the node README (hub-oracle one-shot, reference
scripts, `init`) before expecting blocks.

Health checks:

```sh
curl -s http://localhost:3000/healthz
curl -s http://localhost:3000/readyz
docker compose logs -f midgard-node   # watch startup
```

## Step 4: Generate L2 activity

A freshly migrated database has empty transaction tables; the explorer shows
data only after transactions flow. From `demo/midgard-node`:

```sh
node dist/index.js submit-l2-transfer \
  --l2-address <destination-l2-address> \
  --lovelace 5000000 \
  --wallet-seed-phrase-env USER_SEED_PHRASE
```

A submitted transfer lands in the `mempool` table immediately; it moves to
`immutable` once the node commits a block. Deposits and withdrawals have their
own flows ("Build An Unsigned L1 Deposit" and the stress-test sections in the
node README) and populate the `deposits_utxos` and `withdrawal_utxos` tables.

## Step 5: Point the explorer at the node's database

The explorer needs more than the node's connection details. It also owns a
PostgreSQL database of its own, holding everything it observed on Cardano, and
it reads a deployment manifest to know which contracts to follow. All three are
required settings: the backend refuses to boot without them, and it answers 503
on `/readyz` until the index has been migrated.

`pnpm setup` writes all of it from one file:

```sh
cd backend
pnpm install
pnpm setup
```

Then fill the node's own connection details in `backend/.env`, matching the
node's `.env` (host `localhost`, port `5433`), and the manifest the node wrote:

```text
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DB=midgard
MIDGARD_MANIFEST_PATH=/abs/path/to/midgard/demo/midgard-node/deploymentInfo/contract-deployment-info.json
```

Run `pnpm setup` again to carry those values into `.dev/runtime.env`, then
create the disposable test database:

```sh
pnpm setup:test
```

Check the machine before starting anything:

```sh
pnpm doctor --with-l1-sync
```

Every failure names the command that fixes it. Then start the explorer,
indexing Cardano as well since the node is live:

```sh
pnpm dev:l1
```

This starts the explorer's PostgreSQL, applies the index migrations, starts the
API in the foreground, and prints the cursors as they move until strict
readiness is met. In a second terminal:

```sh
cd frontend-new
pnpm install
pnpm dev
```

The node holds port 3000 and its monitoring stack holds 3100, which is why the
explorer's ports default to 3101 and 3011. Change them in `.dev/runtime.env`
and re-run `pnpm setup --force`.

## Step 6: Verify

```sh
cd backend && pnpm status

# Liveness, which touches no database:
curl -s http://localhost:3101/healthz

# Whether it can serve everything, including a completed Cardano reconciliation:
curl -s http://localhost:3101/readyz

# After a transfer from Step 4:
curl -s "http://localhost:3101/api/transaction?tx_hash=<tx hash printed by submit-l2-transfer>"
```

Open http://localhost:3011: the home page lists recent blocks and transactions,
and the transaction page shows the transfer with its status.

## Troubleshooting

- **Backend responds 500 with a Postgres connection error**: the node stack is
  not up, or the `POSTGRES_*` values in `backend/.env` do not match the node's
  `.env`. Postgres is on host port 5433, not 5432.
- **Migration service fails on an old volume**: you are in the fresh-deployment
  case of Step 1; the volume cannot be migrated in place.
- **Pages are empty but the node is healthy**: no L2 activity yet. Submit a
  transfer (Step 4); genesis alone seeds only ledger tables, not the
  transaction tables the list pages read.
- **`pnpm install` fails with an integrity error in the node repo**: the
  `midgard-sdk` tarball moved ahead of `pnpm-lock.yaml`; see the note under
  "How to Run" in the node README.
- **Backend fails to bind its port**: the node's monitoring stack publishes Loki
  on host port 3100, and the node's own API holds 3000. The explorer backend uses
  3101 for that reason. Change ports in `.dev/runtime.env` and re-run
  `pnpm setup --force`, which regenerates every file that has to agree about
  them; editing one by hand is how the frontend ends up calling an origin
  nothing is listening on.
- **Kupo stays `unhealthy` and the node never starts**: Kupo answers `/health`
  with 202 while it indexes and only returns 200 at the chain tip, so Compose can
  declare the dependency failed while Kupo is still working normally. Kupo keeps
  running; wait for a 200, then start `midgard-node`.
