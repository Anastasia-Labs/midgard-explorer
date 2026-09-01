# Running the explorer on demo data

The frontend package runs this mode in one terminal, in the foreground:

```sh
cd frontend-new && pnpm dev:demo
```

`./dev up demo` below runs the same thing in the background, and adds
`status`, `logs` and `down`.

Demo mode runs the web app against a fixture backend that serves the same routes
as the real API from committed data. It needs no Docker, no database, no
secrets, no Midgard node and no Cardano node.

Use it for interface work, for reviewing a change, and as the first thing you
run after cloning.

## What you need

Node 24 and pnpm 11. `corepack enable` provides pnpm at the pinned version.

1 GB of free memory is the measured floor, and 3 GB is comfortable. See
[Resource requirements](resource-requirements.md).

## Start it

```sh
./dev doctor demo
./dev up demo
```

`doctor` reports anything that would stop the mode and names the command that
fixes it. `up` installs the frontend dependencies if they are missing, chooses
free ports, starts the fixture API and the web app, and prints where they are:

```text
Explorer:  http://127.0.0.1:3010
API:       http://127.0.0.1:3110
Status:    healthy
Mode:      demo data
```

From a clean clone with a warm pnpm store this takes about 25 seconds. A cold
install adds however long the download takes, which is set by your connection
rather than by this repository.

`Status: healthy` means the overview page was requested and returned 200, not
only that a process is listening.

## While it runs

```sh
./dev status              # what is running, and whether it answers as itself
./dev logs                # both services
./dev logs app --follow   # one, tailed
./dev down                # stop
```

`up` is safe to run again. A second run reports the running instance rather than
starting a second one.

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

It avoids 3210 and 3211, which the end-to-end suite owns, so you can run the
suite while demo mode is up.

## When it does not start

`./dev up demo` names the cause. The two that come up most:

**A Next dev server is already running.** Next allows one development server per
project directory whatever port each is given, so this stops the mode even when
the port is free. The message carries the process id to stop.

**The app never serves the overview page.** Read `./dev logs app`. On a machine
with exhausted swap the bundler can report a panic while compiling the
stylesheet; check `free -m` before reading that as a code failure.
[Resource requirements](resource-requirements.md) records what was measured.
