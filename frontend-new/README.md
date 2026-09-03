# Midgard Explorer frontend

The explorer's pages. A workspace of three pnpm packages: `app` (Next.js),
`contracts` (the response schemas both sides share) and `ui` (design tokens).

Every command below runs in this directory.

## Before you start

- Node.js 24 and pnpm 11, from `corepack enable`.
- For real data, the backend running on <http://127.0.0.1:3101>. Demo mode
  needs nothing else at all.

## Install

```sh
pnpm install
```

## Start it against the backend

```sh
pnpm dev
```

Open <http://127.0.0.1:3011>.

There is no file to generate first. The app calls <http://127.0.0.1:3101> by
default, which is where `cd backend && pnpm dev` serves. If nothing answers
there, this command says so and stops rather than rendering a page of errors.

To point somewhere else, for one run or for good:

```sh
NEXT_PUBLIC_API_BASE=https://api.example pnpm dev     # this run
echo 'NEXT_PUBLIC_API_BASE=https://api.example' >> app/.env.local
```

To serve on another port, set `PORT`.

## Start it on demo data

```sh
pnpm dev:demo
```

One terminal, no backend, no Docker, no database and no secrets. It starts the
fixture API, checks that the port really answers as the fixture rather than as
something else, and starts the app against it. The records are committed
fixtures and the interface labels them as demo data.

Ctrl-C stops both.

## Run the checks

```sh
pnpm check      # formatting, lint, typecheck and the unit suites
```

Individually:

```sh
pnpm format:check
pnpm lint                     # eslint, and the type-scale check
pnpm typecheck
pnpm test                     # every package's unit suite
```

## Run the browser suite

```sh
pnpm test:e2e
```

Playwright starts its own fixture API and app on ports 3210 and 3211, so it
runs while `pnpm dev` or `pnpm dev:demo` is up.

```sh
pnpm fixtures                 # the fixture API alone
pnpm check:dev-console        # fails on console noise in development
pnpm test:canvas-reliability  # repeats the transaction canvas to catch flake
```

## Measure what it costs to run

```sh
pnpm measure limit 1024          # serve the app under a 1024 MB ceiling
pnpm measure limit 1024 --build  # build it under one
```

Each run mounts this workspace into a container with `--memory` enforced, so a
ceiling is a ceiling rather than a request. The published floors in
[Resource requirements](../docs/resource-requirements.md) are what these runs
reported.

## Build for production

```sh
pnpm build
pnpm start
```

A production build refuses to complete unless the deployment configuration is
named explicitly: `NEXT_PUBLIC_API_BASE`, `API_BASE_SERVER`,
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_NETWORK_LABEL` and the L1 explorer link
template. The development default is not allowed to become a deployment's
answer by accident.

## Commands

| Command                     | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                  | The app against the backend, refusing to start if nothing answers. |
| `pnpm dev:demo`             | The app and the fixture API, in one terminal.                      |
| `pnpm check`                | Formatting, lint, typecheck and the unit suites.                   |
| `pnpm test`                 | Unit suites only.                                                  |
| `pnpm test:e2e`             | The Playwright suite, on its own ports.                            |
| `pnpm build` / `pnpm start` | The production build, then serve it.                               |
| `pnpm fixtures`             | The fixture API alone.                                             |
| `pnpm measure`              | The memory floor, measured under an enforced ceiling.              |
| `pnpm format`               | Rewrites formatting; `format:check` only reports.                  |

## Layout

| Path                            | What it holds                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app/src/app/`                  | Routes. Each one resolves its parameters, fetches, and decides what a failure looks like.                    |
| `app/src/features/`             | What each page shows, given the records it was handed.                                                       |
| `app/src/components/ui/base/`   | What any explorer would have: layout, tables, tabs, tooltips, timestamps.                                    |
| `app/src/components/ui/domain/` | What only this one has: addresses, amounts, journeys, validators, the metrics panel, the transaction canvas. |
| `app/src/lib/`                  | Formatting, classification, and the API client.                                                              |
| `app/src/app/styles/`           | The stylesheet in four parts: tokens, base, features, motion.                                                |
| `contracts/`                    | Response schemas, shared with the backend's tests.                                                           |
| `ui/`                           | Design tokens.                                                                                               |

## Where the data comes from

`app/e2e/fixtures/server.mjs` answers the same routes as the real API from
committed records. It is what `pnpm dev:demo` and the browser suite both use, so
a route that changes shape breaks one of them before it reaches a reader.
