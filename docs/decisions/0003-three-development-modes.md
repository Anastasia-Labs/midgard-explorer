# 3. The explorer runs in three named modes

Accepted 2026-09-01.

This records the contract the `dev` command is built to. None of the commands,
modes or scopes below exist in the tree yet; each one lands against this record.

## Decision

A contributor picks a mode before starting anything. Each mode names what it
starts, what it needs, and what it can show.

| Mode | Starts | Needs | Shows |
|---|---|---|---|
| `demo` | the fixture API and `frontend-new/app` | Node 24 and pnpm 11 | fixture data, labeled as fixture data |
| `existing` | explorer PostgreSQL, its migrations, the backend, the API cache and `frontend-new/app` | the above, Docker, and a reachable Midgard PostgreSQL | real L2 blocks, transactions, addresses and UTxOs |
| `existing --with-l1-sync` | the same, plus the L1 indexer | the above, a deployment manifest and a Koios URL | the same, plus L1 transactions, deposits and validator activity |
| `full` | the Midgard node stack as well | the above, Cardano Node, Kupo, Ogmios, and funded Preprod wallets | live L2 activity as it is produced |

`demo` runs no database and no Docker. It is the mode a first-time contributor
uses.

## The supported frontend is `frontend-new/`

Every frontend command, mode, document and continuous-integration job described
here targets `frontend-new/`. `frontend/` is the previous Vite client. It stays
in the tree and stays buildable, and nothing in this record moves, edits, tests
or gates it.

Each root remains its own pnpm workspace. [ADR 1](0001-separate-workspaces.md)
records why. The developer command runs the workspaces, it does not merge them.

## Readiness has two scopes, and production keeps the strict one

`GET /readyz` is unchanged. It runs all four probes and answers `503` naming the
one that failed, which is what a load balancer and a rollout gate read.

Development adds a second scope, on the command line only:

```sh
cd backend && pnpm readiness -- --scope=l2
```

| Probe | `--scope=l2` | `/readyz` and the default scope |
|---|:--:|:--:|
| `probeNodeDatabase` | yes | yes |
| `probeIndexDatabase` | yes | yes |
| `probeIndexReconciled` | no | yes |
| `probeManifest` | no | yes |

The L2 scope exists because the L1 index is reconciled by a network-dependent
pass against Koios, and a contributor reading real L2 records does not need it.
Dropping `probeManifest` from that scope follows the same reasoning: `existing`
mode starts with a placeholder manifest path, and the manifest describes the L1
deployment only.

The L2 scope has no HTTP surface. Adding one would give a load balancer a second
answer to the question it already asks.

## "L2-only" does not mean Docker-free

`probeIndexDatabase` stays in the L2 scope, so `existing` mode still starts the
explorer's own PostgreSQL and applies its migrations. The mode drops the L1
reconciliation, not the index. `demo` is the only Docker-free mode.

## An absent L1 index degrades fields, it does not refuse routes

`/api/l1/summary` reports the sync state, and `frontend-new` reads it to tell "no
L1 activity yet" apart from "the L1 index has not been built". The L1 list routes
keep answering `200` with empty results.

No route gains a capability `503`. The backend already treats an unreadable
deployment manifest as lost attribution rather than a lost record:
`src/server/routes/withdrawals.ts` returns a null network and says so in the
response, and `src/db/l1.ts` does the same for L1 rows. A second model for the
same absence would leave two answers for one condition.

## Automatic migrations are for disposable databases only

`dev setup` creates and migrates a database when it owns it. A database is
disposable when `dev` created it, it runs on a local Docker service this
repository defines, and its name ends in `_test` or matches the one this
repository's Compose file provisions.

Every other database is migrated by hand through the rollout recorded in the
README. The index is written by exactly one process, and the rollout holds an
advisory lock across the migration for that reason. A convenience command that
migrates whatever `INDEXER_POSTGRES_URL` names would migrate a real index from a
contributor's shell.

## No command deletes Midgard state

Nothing in `dev` removes a Docker volume, an MPF directory, a database or an
on-chain deployment as a side effect of starting or stopping. A command that
destroys state is a separate verb. It prints every volume, directory and on-chain
action it will affect, and waits for confirmation.

## Ports are selected automatically in demo mode only

`demo` picks free ports and prints them, because nothing else has to agree with
the number it picked.

`existing` and `full` report a conflict and stop. Their ports are coordinated
with services this repository does not own, and `NEXT_PUBLIC_API_BASE` is read at
build time, so a silently reassigned port produces a frontend calling an origin
nothing is listening on. An override is explicit.

## Configuration has one source

`dev setup` writes `.dev/runtime.env` and generates the backend and frontend
environment files from it. Ports, origins, database URLs and the local database
password are written once and read from there. `.dev/` is not tracked.

## What the gates claim

A gate claims what it measured.

| Runs | Claim |
|---|---|
| every pull request | `demo` starts from a clean clone and serves the fixture; `existing` starts, reports L2 readiness, and renders seeded L2 records |
| nightly or on request | `existing` renders records from a real Midgard node database; the full deployment completes end to end |

The seeded records come from a deterministic L2 fixture generated from
`backend/test/fixtures/schema/midgard-node.sql`, carrying enough rows to render
the overview, the block and transaction pages, and the address and UTxO paths. A
continuous-integration check regenerates it and fails on a difference, so the
fixture cannot drift from the schema it was generated against.

The node-schema fixture holds no rows of its own. A job run against it proves
that the mode starts, and that is the only claim such a job makes.

## Performance budgets

`demo` reaches a populated explorer in under five minutes from a clean clone with
a warm pnpm store. That is the gate.

Cold-install time is measured and published beside it, and is not gated, because
network speed sets it rather than this repository.

Minimum and recommended memory per mode is published in
[Resource requirements](../resource-requirements.md), measured on 2026-09-01 under
enforced container ceilings. `full` has no figure, because the mode is not built
and the Cardano services dominate the answer.

## Consequences

A contributor picks a mode first, and the mode decides what they install. The
question "what do I need running?" has three answers instead of one.

Adding a check to `dev doctor` means naming the mode it applies to. A check that
fails in `demo` for a reason only `full` has is a check in the wrong place.

Adding a route that reads the L1 index means deciding what it answers when the
index is empty. That answer is an empty result, not an error.
