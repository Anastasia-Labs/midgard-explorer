#!/usr/bin/env bash
# CI parity for frontend-new. Run this before proposing any commit; a
# from-memory subset of checks is not a gate.
#
#   ./scripts/ci-local.sh          full gate
#   ./scripts/ci-local.sh --fast   skip the e2e suite
set -euo pipefail

cd "$(dirname "$0")/.."

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

step() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

step "node / pnpm versions"
node -v
pnpm -v

step "install (frozen lockfile)"
pnpm install --frozen-lockfile

step "format check"
pnpm exec prettier --check .

step "lint (workspace rules)"
pnpm exec eslint .

step "lint (Next and React Compiler rules)"
# The workspace config at the root does not extend eslint-config-next, so the
# React Compiler rules live only in the app's own config and only run when
# eslint is invoked from there. Two of the five errors they last reported were
# real defects rather than style, so the gate has to run both.
pnpm --filter @midgard-explorer/app lint

step "typecheck: contracts"
pnpm --filter @midgard-explorer/contracts exec tsc --noEmit

step "typecheck: app"
pnpm --filter @midgard-explorer/app exec tsc --noEmit

step "unit tests"
pnpm --filter @midgard-explorer/app exec vitest run

step "production build"
MG_STRICT_CONFIG=1 \
NEXT_PUBLIC_NETWORK_LABEL="${NEXT_PUBLIC_NETWORK_LABEL:-Preprod}" \
NEXT_PUBLIC_L1_EXPLORER_TX_URL="${NEXT_PUBLIC_L1_EXPLORER_TX_URL:-https://preprod.cexplorer.io/tx/{hash}}" \
NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL="${NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL:-https://preprod.cexplorer.io/address/{address}}" \
NEXT_PUBLIC_L1_EXPLORER_NAME="${NEXT_PUBLIC_L1_EXPLORER_NAME:-CExplorer}" \
  pnpm --filter @midgard-explorer/app exec next build

if [[ $FAST -eq 0 ]]; then
  step "e2e (fixture backend)"
  # Dedicated ports. `reuseExistingServer` is on outside CI, so on the default
  # ports the gate will adopt a dev server, or a production build started by
  # hand before the last edit, and report a pass for code it never loaded.
  # That has already happened here. Ports nothing else uses mean the gate
  # builds and starts exactly what it is about to test.
  E2E_PORT=3210 FIXTURE_PORT=3211 \
    pnpm --filter @midgard-explorer/app exec playwright test
else
  printf '\n(skipped e2e: --fast)\n'
fi

printf '\n\033[1;32mGate green.\033[0m\n'
