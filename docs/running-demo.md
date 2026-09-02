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
