# 5. pnpm is the only way to run the explorer

Accepted 2026-09-02. Supersedes the `./dev` section of
[ADR 4](0004-two-package-development.md).

## Decision

Every development command is a pnpm script in the package that owns what it
starts. The repository root carries no command of its own.

| To do this | Run |
|---|---|
| the explorer against a Midgard database | `cd backend && pnpm dev`, then `cd frontend-new && pnpm dev` |
| the same, and index Cardano | `cd backend && pnpm dev:l1` |
| the explorer with no backend at all | `cd frontend-new && pnpm dev:demo` |
| find out what is wrong | `cd backend && pnpm doctor` |
| stop the containers | `cd backend && pnpm services:down` |

`./dev up`, `./dev doctor`, `./dev setup`, `./dev status`, `./dev logs` and
`./dev down` are removed, along with the shell that implemented them.

## Why the root command went

ADR 4 kept `./dev` on the grounds that running the whole stack from one terminal
is a different shape from a foreground package command, and that it implemented
nothing twice. Both were true, and neither was worth what it cost.

**Two entry points are two things that must agree.** The rules lived in one
place each, but the sequencing did not: `./dev up existing` called `pnpm dev`,
which re-derived whether to index and turned it off, so `--with-l1-sync` set a
flag that the command it delegated to then cleared. The bug was invisible in
both implementations and lived only in the seam between them.

**Backgrounding is what `status`, `logs` and `down` were for.** A command that
runs in the foreground puts its log in the terminal that started it, and Ctrl-C
stops it. Three subcommands existed to recover what backgrounding had taken
away.

**The other repositories in this organisation are pnpm.** A contributor arriving
from one of them already knows `pnpm install`, `pnpm dev`, `pnpm check`. A
repository-specific shell command is a thing to learn before anything can be
run.

## The API cache is not a development concern

`docker-compose.yml` defines an Nginx cache in front of the API, and production
uses it. `./dev up existing` started it, which was its one genuine capability
that no package command had.

Nothing about the API's meaning changes when the cache is absent: it caches
responses the backend already produces, and the frontend calls the backend
directly. Verifying the cached shape is a deployment question, and it is
answered where deployment is: `docs/production-data-path.md` and the rollout
script.

## Consequences

`backend/scripts/` holds the lifecycle, the setup, the doctor and its checks,
the compatibility pin and the documentation gate. `frontend-new/app/scripts/`
holds demo mode and the resource measurement. Each is reachable only through
the pnpm script that names it.

Continuous integration gates the supported commands and nothing else: the
backend's own checks, the frontend's, and one run of the two commands the README
documents against a seeded node database.

The documentation gate refuses a page that names `./dev`, so the command cannot
return to the guides without returning to the repository.
