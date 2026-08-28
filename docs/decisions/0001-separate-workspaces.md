# 1. Each root is its own pnpm workspace

Accepted 2026-08-28.

## Decision

`backend/`, `frontend-new/` and `frontend/` are each a standalone pnpm
workspace with its own `pnpm-workspace.yaml` and its own `pnpm-lock.yaml`.
There is no workspace at the repository root, and no root `package.json`.

`frontend-new/` is itself a workspace of three members: `app`, `contracts` and
`ui`. That nesting is the level at which packages are shared.

## Why

**The roots run different Node majors.** `backend/package.json` requires Node
`>=22.13.0`; `frontend-new/package.json` requires `>=24`. One lockfile resolved
against one engine cannot express both, and the looser of the two is the one
that stops catching mistakes.

**The frontend lockfile carries policy the backend must not inherit.**
`frontend-new/pnpm-workspace.yaml` pins `nanoid`, `postcss` and `sharp` through
`overrides`, allows build scripts for `sharp` and `unrs-resolver`, and lists
specific versions in `minimumReleaseAgeExclude`. Each entry is a decision about
the Next.js dependency tree. Merged into a root workspace they would apply to
the API and the indexer as well, silently widening what those install.

**Continuous integration already treats them as separate.** The two jobs in
`.github/workflows/ci.yml` set different working directories and each runs its
own `pnpm install --frozen-lockfile`. A root workspace would couple the jobs:
a change to a frontend dependency would invalidate the backend install, and the
backend job would rebuild for a change it does not depend on.

**The two are deployed separately.** The API and the indexer ship as a Node
process; the web app ships as a Next.js build. They share no runtime and no
release, and the wire contract between them is a versioned package rather than
a source import.

## What this costs

Three installs rather than one, and roughly 1.1 GB across the three
`node_modules` trees. pnpm hardlinks into a shared store, so the trees overlap
heavily and the figure is not three separate copies.

A package cannot be imported across roots. `@midgard-explorer/contracts`
describes API responses and lives in the frontend workspace, so the API
describes its own responses independently and
`frontend-new/app/test/fixture-contract.test.ts` checks that the two agree.

## Consequences

Adding a dependency means choosing a root first. Adding a shared package means
adding it to `frontend-new/pnpm-workspace.yaml`, not to a root that does not
exist.

Consolidating into one workspace would mean reconciling the two Node
requirements, scoping the frontend overrides so they stop at the frontend, and
splitting the continuous integration cache back apart. That is a larger change
than it appears from the file listing, and this record exists so the size of it
is visible before it is proposed again.
