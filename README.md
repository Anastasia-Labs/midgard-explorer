# Midgard Explorer

This repository contains the backend and frontend for the Midgard explorer.

## Prerequisites

Before starting the explorer, you need the following services from the
[Midgard repository](https://github.com/Anastasia-Labs/midgard) running locally:

- `midgard-node`
- PostgreSQL

Follow the setup instructions from the Midgard repository first. The explorer
expects to connect to the Postgres instance started there.

You also need:

- Node.js
- npm

## Environment files

Create local environment files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### `backend/.env`

The backend reads its configuration from `backend/.env`.

Important values:

- `BACKEND_PORT`: port used by the backend server. The default is `3100`.
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

- `VITE_BACKEND_URL`: backend base URL used by the frontend.

For local development, the default value `/api` is correct. Vite proxies `/api`
to `http://localhost:3100`.

## Install dependencies

Install dependencies in both apps:

```bash
cd backend
npm install
```

```bash
cd frontend
npm install
```

## Run the explorer

Once `midgard-node` and Postgres are running, start the backend:

```bash
cd backend
npm run dev
```

Then, in a second terminal, start the frontend:

```bash
cd frontend
npm run dev
```

The frontend will call the backend through the local Vite proxy, and the backend
will read explorer data from the Midgard Postgres database.
