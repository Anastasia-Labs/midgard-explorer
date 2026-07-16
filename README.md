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

## Environment files

Create local environment files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### `backend/.env`

The backend reads its configuration from `backend/.env`.

Important values:

- `BACKEND_PORT`: port used by the backend server. The default is `3101`.
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
  `POSTGRES_DB`: connection details for the Postgres instance started from the
  Midgard setup.
- `POSTGRES_URL`: Prisma connection string built from the values above.
- `LOG_LOCATION`: location of backend log files.
- `RECENT_BLOCKS_LIMIT`, `RECENT_TRANSACTIONS_LIMIT`, `POOLS_PER_PAGE`,
  `TRANSACTIONS_PER_PAGE`, `BLOCKS_PER_PAGE`: explorer API limits and pagination
  settings.

Update the Postgres values so they match your local Midgard database.

### `frontend/.env`

The frontend reads its configuration from `frontend/.env`.

- `VITE_API_BASE_URL`: backend origin for split (cross-origin) deployments.

For local development, leave it empty. The frontend then calls relative `/api`
paths, which Vite proxies to `http://localhost:3101`.

## Install dependencies

Install dependencies in both apps:

```bash
cd backend
pnpm install
```

```bash
cd frontend
pnpm install
```

## Run the explorer

Once `midgard-node` and Postgres are running, start the backend:

```bash
cd backend
pnpm dev
```

Then, in a second terminal, start the frontend:

```bash
cd frontend
pnpm dev
```

The frontend will call the backend through the local Vite proxy, and the backend
will read explorer data from the Midgard Postgres database.
