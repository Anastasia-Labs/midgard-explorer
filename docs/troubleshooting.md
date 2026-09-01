# Troubleshooting

Run `./dev doctor <mode>` first. It reports each problem under a stable id, and
this page is organised by those ids, so what the terminal printed is what you
search for here.

```sh
./dev doctor demo
./dev doctor existing
./dev doctor demo --json     # for a script
```

Exit codes: `0` nothing failed, `1` at least one check failed, `2` the command
was used wrongly.

Doctor is read-only. It installs nothing, starts nothing, migrates nothing and
writes nothing, so it is safe to run against a machine mid-incident.

## Toolchain and platform

**`toolchain.node`** Node is older than 24. `frontend-new` requires 24 and
continuous integration runs it. The backend's own floor is `>=22.13.0`, which is
lower, but the repository is supported on 24. Run `nvm use 24`.

**`toolchain.pnpm`** pnpm is absent or not version 11. Run `corepack enable`;
`packageManager` in each `package.json` pins the exact version.

**`platform.memory`** Less memory is available than the mode's measured floor.
The floors are in [Resource requirements](resource-requirements.md) and were
measured under enforced container ceilings, not chosen.

**`platform.swap`** Swap is nearly exhausted. This is worth taking seriously
before reading a build failure as a code failure: the one Turbopack panic
recorded on this stack happened with 106 MB free and swap at 1999 MB of 2048 MB,
and did not reproduce in eleven later runs including six under a hard ceiling
with no swap at all.

## Both modes serve one directory

**`dev.next-lock`** A Next development server already holds
`frontend-new/app`. Next allows one per project directory whatever port each is
given, so a free port is not enough. The message carries the process id; stop it
with `kill <pid>`. A lock whose process is gone is ignored, so a crashed server
does not block the next start.

If the process is the one this mode started, this check passes rather than
failing: the id is matched by process descent, because the launcher records the
`pnpm` process while Next writes the server one fork below. If it is the other
mode's server, the check names that mode and the fix is `./dev down`, because
demo and existing serve the same directory and only one of them can.

## Demo mode

**`demo.ports`** The preferred ports are in use. Demo mode selects the next free
port automatically and prints it, so this is information rather than a failure.

**The explorer never serves the overview page.** `./dev logs app`. `Status:
healthy` requires the overview page to return 200, not only that a process is
listening, so this failure means the app is genuinely not serving. A route
handler compiles without the stylesheet every page pulls in, which is how
`/api/health` once answered 200 through a bundler failure that made every page
return 500.

## Configuration

**`backend.env-file`** `backend/.env` does not exist. Run
`./dev setup existing`, which generates it from `.dev/runtime.env`.

**`backend.env-complete`** A required setting is empty. The backend refuses to
boot with any of these unset and lists all of them, so this is the same list
before anything starts.

**`backend.env-url-parts`** A connection string names no user or no database.
The shipped example composes `POSTGRES_URL` from `POSTGRES_USER` and the rest,
each of which ships empty, so the composed string is non-empty and satisfies
every check that only asks whether a value is present, while naming nothing.

**`backend.env-placeholders`** A setting still holds an example value such as
`CHANGEME` or `/abs/path/to/contract-deployment-info.json`. The file was copied
and not filled in.

**`config.permissions`** A file holding a database password is readable by more
than its owner. Run `chmod 600` on the files named.

**`config.drift`** A generated file no longer matches `.dev/runtime.env`. Run
`./dev setup existing --force`, which copies the current file to `.backup`
before regenerating it.

## Databases

**`existing.node-db-reachable`** Nothing accepts connections at the Midgard
node's PostgreSQL. Start it; see
[Running the full Midgard stack](running-full-midgard.md). Its host port is
5433, not 5432.

**`existing.index-db-reachable`** The explorer's own PostgreSQL is not running.
Run `docker compose --env-file .dev/runtime.env up -d explorer-postgres`, or let
`./dev up existing` start it.

**`existing.test-db-distinct`** The test database is not named `_test`, or it is
the same database as the index. The backend suite truncates whatever
`TEST_INDEXER_POSTGRES_URL` names, and refuses any name that does not end in
`_test`. Run `./dev setup test`, which creates and migrates it and refuses any
target that is not disposable.

**`readiness.node-database`** and **`readiness.explorer-index`** A database is
missing relations the read path queries, or the index is missing a migration
this build ships. These come from the backend's own readiness probe rather than
from a second list, so the answer is the same one `/readyz` gives. Run
`cd backend && pnpm indexer:deploy` for a missing migration.

**`readiness.index-reconciled`** and **`readiness.manifest`** In `existing` mode
with the indexer off, these read `not checked`: doctor runs the L2 scope, which
covers neither. In `full` mode, and in `existing` mode with
`L1_SYNC_ENABLED=true`, doctor runs the full scope and both are failures. Either
way `/readyz` still refuses, which is what keeps such an instance out of
rotation.

**`existing.manifest-file`** `MIDGARD_MANIFEST_PATH` is unset or names no file.
A warning while the indexer is off, because an explorer serving L2 records never
opens the manifest, and a failure once it is on, because rows indexed without it
are attributed to nothing.

**Migrations were not applied, and the message says the index is not one `dev`
owns.** `./dev up existing` migrates exactly one database: the one this
repository's Compose file publishes and this command started. Ownership is
checked against what `docker compose port explorer-postgres 5432` answers, plus
the user and database name in `.dev/runtime.env`, and the message names which of
them did not match. Every other index is migrated through
`cd backend && ./scripts/rollout.sh --apply`, which holds the indexer's advisory
lock across the migration.

## Compatibility

**`compat.node-schema`** The node's schema is compared against the fingerprint
this build pins, using the relation list readiness already derives from the read
path.

A node holding *more* than the pinned schema is compatible and reported as a
warning naming the extra columns. A node *missing* something the explorer reads
is a failure, and the message names the relation and column, because
"incompatible" on its own sends you to diff two schemas by hand.

Regenerate the pin from the committed schema fixture with `./dev compat write`
after a deliberate upgrade.

**`compat.manifest-version`** The manifest declares a schema version outside
what this build supports. The list comes from the indexer, which refuses an
unknown layout rather than reading it on a guess.

**`compat.deployment`** The manifest identifies the deployment, so it is
compared against `midgard.verifiedAgainst.manifestId`. A different id is not a
fault: it means this build's verification does not cover the deployment being
read. The check keeps warning while `midgard.commit` is null, because a branch
moves and the recorded branch says nothing about which revision anybody ran.
That value comes from the build record of the node being run; a local checkout
is not evidence of what produced a deployment.

**`readiness.*` reported as FAIL rather than SKIP** The readiness probe could
not be run at all. Doctor cannot say whether the mode would serve until it runs,
so this sets the exit code instead of being skipped past. Run
`cd backend && pnpm readiness` to see the underlying error.

## ERROR, rather than FAIL

A check reported as `ERROR` could not be run: it threw, which is a defect in the
check rather than a verdict on the machine. It still sets the exit code and
withholds `Ready`, because a report holding a check nobody could run is
incomplete, and the check that could not run may be the one that would have
objected.

## Cardano pages are empty

This is not necessarily a fault. `/api/l1/summary` reports which case it is, and
the page says so:

| State | Meaning |
|---|---|
| `unbuilt` | Nothing has been indexed. The page cannot show activity even if the chain has some. |
| `indexing` | A pass in which every source completed has not finished. The page names every cursor height. |
| `reconciled` | The index is current and the chain is quiet here. |

Index Cardano with `./dev up existing --with-l1-sync`, which needs a deployment
manifest and a Koios URL.

## Stopping things

`./dev down` stops what `./dev` started. It removes no volume, no database and
no Midgard state. Nothing in `./dev` deletes state as a side effect of starting
or stopping.

A container that was already running when `./dev up existing` found it is
adopted rather than started, and `down` leaves it running and says so. Only the
containers this command started are stopped.

`./dev up existing` a second time is a restart, not a conflict: it stops its own
processes first, so the ports and the Next lock its previous run held are its
own to reclaim.
