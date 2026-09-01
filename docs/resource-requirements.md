# Resource requirements

Measured on 2026-09-01. Every figure below says what kind of number it is,
because they are not the same kind and cannot be compared as though they were.

- **Hard floor**: the mode was run inside a container with `--cpus 2`,
  `--memory N`, and `--memory-swap N`, so the ceiling was enforced rather than
  requested. The floor is the smallest ceiling at which the task still
  completed. Reproduce with `node scripts/dev/measure.mjs "$PWD" limit <MB>`.

  The image is `node:24-bookworm-slim`, and the choice is load-bearing. The host
  install resolves the glibc build of the SWC binary, so `next` on a musl image
  fails to load it and reports nothing served at every ceiling. That reads as a
  memory floor and is not one. An earlier matrix taken on Alpine is not
  reproduced here, because pnpm was quietly reinstalling the musl binary inside
  each container, which measured a dependency tree the host does not have.
- **Observed peak**: resident memory of the process tree, sampled every 250 ms
  on a 2-core machine while the mode served the overview, blocks, transactions,
  L1, deposits and assets pages. Reproduce with `measure.mjs ... peak`.
- **Declared limit**: what `docker-compose.yml` caps a container at. Not a
  measurement of anything.
- **Not measured**: exactly that. No number is offered.

## Frontend, under an enforced ceiling

| Ceiling | `next dev` serves the overview | `next build` completes |
|---:|---|---|
| 512 MB | no | not run |
| 768 MB | no | not run |
| 896 MB | yes, in 8s | no, out of memory |
| 1024 MB | yes, in 9s | no, out of memory |
| 1536 MB | yes, in 8s | yes, in 21s |
| 2048 MB | yes, in 8s | yes, in 23s |

The development server's hard floor is between 768 MB and 896 MB. The production
build's is between 1024 MB and 1536 MB, so a machine that can run the dev server
cannot necessarily build the app.

## Per mode

| Mode | Minimum | Recommended | Basis |
|---|---:|---:|---|
| `demo` | 1 GB | 3 GB | Hard floor 896 MB for the dev server, rounded up. Observed peak 1671 MB for the app and fixture together, so the floor is where it works and the peak is where it is comfortable. |
| `existing` | 3 GB | 6 GB | Observed peak 881 MB for the backend under `ts-node`, plus the frontend's 1671 MB, plus declared limits of 512 MB for PostgreSQL and 128 MB for the API cache. Summed, not measured as one figure. |
| `full` | not measured | not measured | Nothing here runs the mode. Adding Cardano Node, Kupo and Ogmios changes the answer by more than the explorer contributes, and no figure is offered until it is run. |

Two CPU cores are enough for `demo` and `existing`. Every measurement above was
taken on two cores.

## Swap

Swap exhaustion is worth checking before reading a build failure as a code
failure. `./dev doctor` reports it, and the reason is in the next section.

## Turbopack

Next 16 uses Turbopack for `next dev` and `next build`. This repository keeps it.

A PostCSS worker failure was observed once, on 2026-09-01, with 106 MB of memory
free and 1999 MB of 2048 MB swap in use. It reported a Turbopack panic whose
cause chain ended in `evaluate_webpack_loader`, `timeout while receiving message
from process`, `deadline has elapsed`. That is a worker process missing a
deadline, not a compilation error.

It has not reproduced since, in eleven subsequent runs:

| Run | Conditions | Result |
|---|---|---|
| Cold `.next` | 6 GB available | served in 11s |
| Warm `.next`, clean shutdown | 6 GB available | served in 11s |
| `.next` left by a server killed mid-compile | 6 GB available | served in 10s |
| 896, 1024, 1536 and 2048 MB enforced ceilings | no swap at all | served, no panic |
| 1536 and 2048 MB ceilings | no swap at all | built, no panic |
| 896 and 1024 MB ceilings, production build | no swap at all | out of memory, no panic |

At every ceiling where the frontend failed it failed by running out of memory or
by never finishing the compile. None of those failures was a panic.

One reproduction correlated with memory exhaustion, and no reproduction under an
enforced ceiling, is not enough to call Turbopack defective. It is enough to say
the question is memory headroom. The bundler is unchanged, and `next dev` and
`next build` continue to use the same one, which is what keeps a development run
exercising what ships.
