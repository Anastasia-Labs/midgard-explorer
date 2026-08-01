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

step "lint"
pnpm exec eslint .

step "typecheck: contracts"
pnpm --filter @midgard-explorer/contracts exec tsc --noEmit

step "typecheck: app"
pnpm --filter @midgard-explorer/app exec tsc --noEmit

step "unit tests"
pnpm --filter @midgard-explorer/app exec vitest run

step "production build"
MG_STRICT_CONFIG=1 \
NEXT_PUBLIC_NETWORK_LABEL="${NEXT_PUBLIC_NETWORK_LABEL:-Preprod}" \
NEXT_PUBLIC_L1_EXPLORER_URL="${NEXT_PUBLIC_L1_EXPLORER_URL:-https://preprod.cardanoscan.io}" \
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
