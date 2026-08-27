#!/usr/bin/env bash
#
# The indexer rollout, in the order that was rehearsed.
#
# Applying the migration on its own is not a rollout: the old binary keeps
# writing under the old rules against the new schema, and the migration resets
# the cursors, so the index is then re-built from genesis by whichever writer
# happens to be running. The steps below are the ones validated on a pg_dump
# copy of production on 2026-08-27 (see .git/gate-evidence/*-rollout-rehearsal.log).
#
#   ./scripts/rollout.sh --check    read-only: current state and readiness
#   ./scripts/rollout.sh --apply    performs the migration; asks for confirmation
#
# --apply does NOT start or stop your writer. Stopping the old one and starting
# exactly one new one is deliberately left to whatever supervises the process,
# because this script cannot know what that is.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:---check}"
strip() { sed -e 's/^"//' -e 's/"$//'; }
env_val() { grep -oP "(?<=^$1=).*" .env | head -1 | strip; }

HOST=$(env_val INDEXER_POSTGRES_HOST); PORT=$(env_val INDEXER_POSTGRES_PORT)
USER=$(env_val INDEXER_POSTGRES_USER); DB=$(env_val INDEXER_POSTGRES_DB)
export PGPASSWORD="$(env_val INDEXER_POSTGRES_PASSWORD)"
Q=(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -tAc)

echo "target: $HOST:$PORT/$DB"
echo
echo "--- current state ---"
"${Q[@]}" "SELECT '  l1_tx           = '||count(*) FROM l1_tx;"
"${Q[@]}" "SELECT '  l1_event        = '||count(*) FROM l1_event;"
"${Q[@]}" "SELECT '  attribution     : '||deployment||' = '||count(*) FROM l1_event GROUP BY deployment;"
"${Q[@]}" "SELECT '  cursor          : '||source||' = '||last_block_height FROM sync_cursor ORDER BY source;"
"${Q[@]}" "SELECT '  column default  = '||coalesce(column_default,'(none)') FROM information_schema.columns
            WHERE table_name='l1_event' AND column_name='deployment';"
UNAPPLIED=$("${Q[@]}" "SELECT count(*) FROM (SELECT 1) x WHERE NOT EXISTS
             (SELECT 1 FROM _prisma_migrations WHERE migration_name='20260827120000_deployment_attribution_repair');")
echo "  repair migration applied = $([ "$UNAPPLIED" = "0" ] && echo yes || echo NO)"

echo
echo "--- readiness on this build ---"
npx ts-node scripts/probe-readiness.ts 2>&1 | grep -E "READY|NOT READY|migrations shipped" || true

if [ "$MODE" != "--apply" ]; then
  echo
  echo "Read-only. Re-run with --apply to perform step 2."
  exit 0
fi

STALE=$("${Q[@]}" "SELECT count(*) FROM l1_event WHERE deployment='default';")
echo
echo "=============================================================="
echo "  About to apply the attribution repair to $DB."
echo "  $STALE event rows sit under 'default'."
echo "  The migration DELETES NOTHING, but it resets the cursors,"
echo "  so the next writer re-indexes from genesis. Expect a full"
echo "  Koios re-scan and an index that is incomplete until it ends."
echo "  Stop the current writer FIRST."
echo "=============================================================="
read -r -p "Type the database name to continue: " CONFIRM
[ "$CONFIRM" = "$DB" ] || { echo "aborted"; exit 1; }

pnpm indexer:deploy
echo
echo "--- after the migration ---"
"${Q[@]}" "SELECT '  column default  = '||coalesce(column_default,'(none)') FROM information_schema.columns
            WHERE table_name='l1_event' AND column_name='deployment';"
"${Q[@]}" "SELECT '  cursor          : '||source||' = '||last_block_height FROM sync_cursor ORDER BY source;"
"${Q[@]}" "SELECT '  rows preserved  : l1_tx='||(SELECT count(*) FROM l1_tx)||' l1_event='||(SELECT count(*) FROM l1_event);"
echo
echo "Now start exactly ONE writer (L1_SYNC_ENABLED=true) and wait for a pass that"
echo "does not say 'additive only'. Then re-run --check: it must show a single"
echo "deployment row that is the manifest's manifestId, no 'default', and all"
echo "three cursors at the same height."
