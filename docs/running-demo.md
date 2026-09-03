# Running the explorer on demo data

One terminal, in the foreground:

```sh
cd frontend-new
pnpm install
pnpm dev:demo
```

Demo mode runs the web app against a fixture backend that serves the same routes
as the real API from committed data. It needs no Docker, no database, no
secrets, no Midgard node and no Cardano node.

Use it for interface work, for reviewing a change, and as the first thing you
run after cloning.

## What you need

Node 24 and pnpm 11. `corepack enable` provides pnpm at the pinned version.

1 GB of free memory is the measured floor, and 3 GB is comfortable. See
[Resource requirements](resource-requirements.md).

## What it prints

```text
Fixture API on http://127.0.0.1:3110
Explorer on http://127.0.0.1:3010
The records shown are fixture data, not a Midgard deployment.
```

From a clean clone with a warm pnpm store this takes about 25 seconds. A cold
install adds however long the download takes, which is set by your connection
rather than by this repository.

The command waits for the fixture to identify itself before starting the app, so
a process listening on that port that is not the fixture stops the run rather
than filling the explorer with records that describe nothing.

Ctrl-C stops both. The fixture holds a port and Next holds the project's
development lock, so one is never left behind by the other.

## What the data is

Every record comes from `frontend-new/app/e2e/fixtures/`, the same fixture the
end-to-end suite runs against. The network label reads `Demo`. Nothing here
describes a real deployment, and no page in this mode is evidence about one.

The fixture serves 26 of the 27 API routes, so the whole interface is reachable:
the overview, block and transaction pages, addresses, assets, Cardano activity,
deposits, withdrawals and forced transactions.

## Ports

Demo mode picks free ports and prints them. It is the only mode that does: its
addresses are passed to the app at startup, so nothing else has to agree with
the number it picked.

It avoids 3101, which the backend uses, and 3210 and 3211, which the end-to-end
suite owns, so you can run the suite while demo mode is up.

## When it does not start

**A Next dev server is already running.** Next allows one development server per
project directory whatever port each is given, so this stops the mode even when
the port is free. Stop the other one first.

**The app never serves the overview page.** On a machine with exhausted swap the
bundler can report a panic while compiling the stylesheet; check `free -m`
before reading that as a code failure.
[Resource requirements](resource-requirements.md) records what was measured.

## Running against a real snapshot

Fixtures describe nothing, and a live node is not always available. A snapshot is
real Midgard data that is allowed to be stale, and the explorer says so rather
than calling it a fixture.

```bash
cd backend
pnpm snapshot:export                        # capture from a node database
pnpm snapshot:verify snapshots/<archive>    # check it against its own manifest
SNAPSHOT_TARGET_URL=... pnpm snapshot:restore snapshots/<archive>
```

The capture takes the whole `public` schema in one transaction, so the tables
agree with each other and the archive carries the enum types its columns are
declared with. `pg_dump` gives cross-table consistency on its own;
`--serializable-deferrable` adds a wait for a snapshot no concurrent ordering
could contradict, and is skipped against a standby, which cannot run
serializable transactions. Alongside the archive it writes a manifest: the
capture time, the source database, the deployment id, the network, a schema
fingerprint, per-table row counts for the eighteen relations the explorer reads,
and a SHA-256.

Four refusals, each of which has a reason rather than a preference:

- Capturing from a **standby** is refused unless `--allow-replica` is passed.
  `pg_dump` would still take one consistent snapshot across tables, but
  PostgreSQL does not permit serializable transactions on a hot standby, so the
  capture cannot also wait for a snapshot no concurrent ordering could
  contradict.
- A **client of a different major version** than the server is refused. A newer
  `pg_dump` writes a preamble an older server rejects, so the capture succeeds
  and only the restore fails, which is the worst moment to find out.
- Restoring over a database **this tool does not own** is refused, and takes
  `--force=<name>` to override. The tool does not create the target: the
  database on the other end of `SNAPSHOT_TARGET_URL` was made by someone, for
  something, and `pg_restore --clean` would drop its objects. A target qualifies
  only when its `public` schema is empty of every object, or when it carries a
  real `explorer_snapshot_meta` marker: the exact columns the restore writes,
  holding exactly one row.
- A **checksum or row-count mismatch** aborts the restore rather than leaving a
  database that answers queries with a subset of the chain.

The restore runs in a single transaction, sets the database read-only, and writes
an `explorer_snapshot_meta` row. Restoring again over the same database is
supported: the read-only setting is cleared for the duration and set again at the
end. The whole manifest is validated first, including a row count for every
relation the explorer reads, so an archive that is incomplete is refused before
anything in the target is dropped. That row is what the explorer reads to report
the source as a snapshot with its capture time, instead of as live or as a
fixture. Archives are build artefacts and are not committed.
