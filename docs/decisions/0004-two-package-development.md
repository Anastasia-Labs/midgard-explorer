# 4. Development is two packages and two terminals

Accepted 2026-09-02.

## Decision

The normal way to run the explorer is two commands in two directories:

```sh
cd backend      && pnpm dev
cd frontend-new && pnpm dev
```

A reachable Midgard node PostgreSQL is the only external prerequisite. Nothing
else is a manual step: no `docker compose` line to copy, no `prisma generate` to
remember, no file to generate in one package so another can start.

Each package owns everything it needs.

| Package | Owns |
|---|---|
| `backend/` | The Midgard connection, the explorer's index, both Prisma clients, the migrations, the L1 indexer, readiness, and the lifecycle of all of it |
| `frontend-new/` | The pages, the demo fixture, and the browser suite |

## `pnpm install` leaves nothing to run by hand

`backend/`'s `postinstall` generates both Prisma clients. pnpm 11 gates a
dependency's build scripts through `allowBuilds`, and this repository keeps
Prisma's own engine build disabled because the driver adapter does not need it,
but a package's own `postinstall` is not gated and runs on every install.

The lower-level `pnpm prisma:generate` and `pnpm indexer:generate` stay, for
maintainers changing a schema.

## The frontend needs no generated configuration

`app/src/lib/env.ts` defaults to `http://127.0.0.1:3101`, which is where the
backend serves. `.env.local` overrides it and is not required. A production
build still refuses to complete unless every deployment base is named
explicitly, so the development default cannot become a deployment's answer.

`setup` therefore writes only backend files. A package that writes into another
directory is a package a contributor cannot reason about.

## The API cache is not part of normal development

`docker-compose.yml` defines an Nginx cache in front of the API, and production
uses it. `pnpm dev` does not start it: nothing about the API's meaning changes
when it is absent, and the frontend calls the backend directly.

`./dev up existing` still starts it, because parity with the deployed shape is
what that command is for.

## `./dev` remains, and implements nothing twice

`./dev up demo` and `./dev up existing` run the whole stack from one terminal,
in the background, with `status`, `logs` and `down`. That is a different shape
from a foreground package command, and it is worth keeping.

What it must not be is a second implementation. The rules that decide whether a
command is safe live in one place each, and both entry points call them:

| Rule | Where it lives |
|---|---|
| Which database a migration may be applied to | `backend/scripts/lib/compose.mjs` |
| Which containers a stop may touch | `backend/scripts/lib/compose.mjs` |
| How configuration is read and validated | `backend/scripts/lib/env.mjs` |
| Whether this instance can serve | `backend/scripts/probe-readiness.ts` |
| How demo mode starts | `frontend-new/app/scripts/dev-demo.mjs` |

`./dev up demo` runs that last file in the background and records its process
id, which is the only thing it adds.

## Consequences

A contributor learns two commands, and the guide for each lives in that
package's own README.

Adding a step to starting the backend means adding it to
`backend/scripts/lifecycle.mjs`, where `./dev` will pick it up too.

[ADR 3](0003-three-development-modes.md) records the modes `./dev` offers and
what each continuous-integration tier may claim. This record narrows its role:
the modes remain, and they are no longer the first thing a contributor meets.
