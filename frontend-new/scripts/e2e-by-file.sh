#!/usr/bin/env bash
# The full e2e suite, one Playwright process per spec file.
#
# For a machine that cannot hold the whole suite in one process. On a two core
# box, one `playwright test` for all of it starts at load 5, passes roughly 170
# tests at normal speed, then climbs past load 120 and everything after times
# out, which reads as flake and is not. A process per file releases the browser
# and its memory between files, and the box is allowed to settle between them.
# The app under test is one production build, served to every file.
#
# `scripts/ci-local.sh` remains the gate. This is the same tests, run in a way a
# small machine can finish, and it reports per file so a failure names its
# spec.
set -u
cd "$(dirname "$0")/../app"
S=${E2E_OUT_DIR:-$(mktemp -d)}
SUM=$S/suite-summary.txt
: > $SUM

# Reuse is opt-in in this config, because adopting a foreign server has twice
# produced a run that described code nobody was testing. The servers below are
# started here, from this build, and `global-setup.ts` verifies the fixture's
# identity before any test runs.
export E2E_PORT=3210 FIXTURE_PORT=3211 E2E_REUSE_SERVER=1

echo "== build ==" >> $SUM
MG_STRICT_CONFIG=1 NEXT_PUBLIC_NETWORK_LABEL=Preprod \
NEXT_PUBLIC_L1_EXPLORER_TX_URL='https://preprod.cexplorer.io/tx/{hash}' \
NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL='https://preprod.cexplorer.io/address/{address}' \
NEXT_PUBLIC_L1_EXPLORER_NAME=CExplorer \
  ./node_modules/.bin/next build > $S/suite-build.log 2>&1 || { echo "BUILD FAILED" >> $SUM; exit 1; }
echo "build ok" >> $SUM

node e2e/fixtures/server.mjs > $S/suite-fixture.log 2>&1 &
FIXTURE_PID=$!
NEXT_PUBLIC_API_BASE=http://127.0.0.1:3211 API_BASE_SERVER=http://127.0.0.1:3211 \
  ./node_modules/.bin/next start --port 3210 > $S/suite-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $FIXTURE_PID $SERVER_PID 2>/dev/null' EXIT

for _ in $(seq 1 40); do
  sleep 2
  curl -fsS http://127.0.0.1:3210/api/health > /dev/null 2>&1 && break
done

for f in e2e/*.spec.ts; do
  # Wait for the box between files so a slow one does not poison the next.
  for _ in $(seq 1 40); do
    [ "$(awk '{print int($1)}' /proc/loadavg)" -lt 12 ] && break
    sleep 15
  done
  start=$(date +%s)
  out=$(./node_modules/.bin/playwright test "$f" --reporter=line 2>&1)
  code=$?
  took=$(( $(date +%s) - start ))
  line=$(printf '%s\n' "$out" | grep -E "^ *[0-9]+ (passed|failed|skipped|flaky)|passed \(|failed \(" | tr '\n' ' ')
  printf '%-34s exit=%s %4ss  %s\n' "$(basename "$f")" "$code" "$took" "$line" >> $SUM
  printf '%s\n' "$out" | grep -E "✘|Error:" | head -5 >> $SUM
done

echo "DONE" >> $SUM
cat $SUM
