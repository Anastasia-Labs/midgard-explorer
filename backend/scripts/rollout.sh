#!/usr/bin/env bash
#
# The indexer rollout, in the order that was rehearsed.
#
# Applying the migration on its own is not a rollout: the old binary keeps
# writing under the old rules against the new schema, and the migration resets
# the cursors, so the index is then re-built from genesis by whichever writer
# happens to be running. The steps below are the ones validated on a pg_dump
# copy of production (see .git/gate-evidence/*-rollout-rehearsal.log and
# docs/release/l1-attribution-repair.md).
#
#   ./scripts/rollout.sh --check    read-only. Exits non-zero unless ready.
#   ./scripts/rollout.sh --apply    performs the migration, after a preflight.
#
# --apply does NOT start or stop your writer. Stopping the old one and starting
# exactly one new one is left to whatever supervises the process, because this
# script cannot know what that is. It does REFUSE to migrate while a writer
# still holds indexer leadership, which is the part it can check for itself.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:---check}"

# The target is read from INDEXER_POSTGRES_URL through the same dotenv + expand
# that prisma.indexer.config.ts uses, so what is inspected below and what
# `pnpm indexer:deploy` migrates cannot be two different databases. They were
# separately-sourced before: this script assembled a target from
# INDEXER_POSTGRES_HOST/PORT/USER/DB, which are not the variable Prisma reads,
# are not documented in .env.example, and are under no constraint to agree with
# it. An operator could confirm one database and migrate another.
TARGET_ENV="$(node - <<'NODE'
const dotenv = require("dotenv");
const { expand } = require("dotenv-expand");
// `quiet` because dotenv prints a banner to stdout, and stdout here is
// shell assignments that get eval'd.
expand(dotenv.config({ quiet: true }));
const raw = process.env.INDEXER_POSTGRES_URL;
if (!raw) {
  console.error("INDEXER_POSTGRES_URL is not set");
  process.exit(1);
}
const u = new URL(raw);
// Single-quote and escape rather than strip: a password containing a quote
// would otherwise be silently mangled into a different password.
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
console.log("HOST=" + q(u.hostname));
console.log("PORT=" + q(u.port || "5432"));
console.log("USER=" + q(decodeURIComponent(u.username)));
console.log("DB=" + q(decodeURIComponent(u.pathname.replace(/^\//, ""))));
console.log("PGPASSWORD=" + q(decodeURIComponent(u.password)));
NODE
)" || { echo "could not resolve INDEXER_POSTGRES_URL"; exit 1; }
# Only the five assignments are eval'd, whatever else a dependency decides
# to print.
TARGET_ENV=$(printf '%s\n' "$TARGET_ENV" | grep -E '^(HOST|PORT|USER|DB|PGPASSWORD)=')
eval "$TARGET_ENV"
export PGPASSWORD

TARGET="$HOST:$PORT/$DB"
Q=(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -tAc)

echo "target: $USER@$TARGET   (from INDEXER_POSTGRES_URL)"
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

# The lock id is read out of the module that takes it rather than copied here,
# so a change there cannot leave this preflight testing a number nothing uses.
LOCK_ID=$(grep -oP 'SYNC_ADVISORY_LOCK = \K[0-9_]+' src/indexer/leadership.ts | tr -d '_')
[ -n "$LOCK_ID" ] || { echo "could not read the leadership lock id from src/indexer/leadership.ts"; exit 1; }
LEADER_HELD=$("${Q[@]}" "SELECT NOT pg_try_advisory_lock($LOCK_ID);")
LEADER_APPS=$("${Q[@]}" "SELECT string_agg(DISTINCT application_name, ', ') FROM pg_stat_activity
              WHERE application_name LIKE 'midgard-explorer-l1-indexer%';")
echo "  writer holding leadership = $([ "$LEADER_HELD" = "t" ] && echo YES || echo no)${LEADER_APPS:+  ($LEADER_APPS)}"

echo
echo "--- readiness on this build ---"
set +e
pnpm run --silent readiness
READY_EXIT=$?
set -e

if [ "$MODE" != "--apply" ]; then
  echo
  # The readiness exit code is the point of --check, and it used to be discarded
  # by a trailing `|| true`: the command printed NOT READY and the script exited
  # 0, so anything gating on it was gating on nothing.
  echo "Read-only. readiness exit = $READY_EXIT. Re-run with --apply to migrate."
  exit "$READY_EXIT"
fi

# Preflight. The migration resets the cursors, and a writer that is still
# running will start re-indexing against a schema it was not built for, from a
# cursor that moved under it. Warning about it was not enough: the advisory
# lock already proves the answer, so it is asked rather than assumed.
if [ "$LEADER_HELD" = "t" ]; then
  echo
  echo "REFUSING: a process still holds indexer leadership on $TARGET."
  echo "Stop the writer, confirm the lock is released, and re-run."
  exit 1
fi

STALE=$("${Q[@]}" "SELECT count(*) FROM l1_event WHERE deployment='default';")
echo
echo "=============================================================="
echo "  About to apply the attribution repair to"
echo "      $TARGET"
echo "  $STALE event rows sit under 'default'."
echo "  The migration DELETES NOTHING, but it resets the cursors,"
echo "  so the next writer re-indexes from genesis. Expect a full"
echo "  Koios re-scan and an index that is incomplete until it ends."
echo "  Keep this deployment OUT OF ROTATION until readiness passes"
echo "  again: it reports NOT READY for the whole re-index."
echo "=============================================================="
# The full host:port/database, not the database name alone. Two hosts commonly
# carry the same database name, and naming only the database is exactly the
# confirmation that cannot tell them apart.
read -r -p "Type $TARGET to continue: " CONFIRM
[ "$CONFIRM" = "$TARGET" ] || { echo "aborted"; exit 1; }

pnpm indexer:deploy
echo
echo "--- after the migration ---"
"${Q[@]}" "SELECT '  column default  = '||coalesce(column_default,'(none)') FROM information_schema.columns
            WHERE table_name='l1_event' AND column_name='deployment';"
"${Q[@]}" "SELECT '  cursor          : '||source||' = '||last_block_height FROM sync_cursor ORDER BY source;"
"${Q[@]}" "SELECT '  rows preserved  : l1_tx='||(SELECT count(*) FROM l1_tx)||' l1_event='||(SELECT count(*) FROM l1_event);"
echo
echo "Now start exactly ONE writer (L1_SYNC_ENABLED=true) and wait for a pass that"
echo "does not say 'additive only'. Then re-run --check: it exits 0 only once no"
echo "rows remain under 'default' and all three cursors have advanced past zero."
