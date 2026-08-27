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
# script cannot know what that is. What it does do is TAKE indexer leadership
# and hold it across the migration, so a writer that is still running, or that a
# supervisor restarts mid-migration, cannot index against a schema and a cursor
# moving under it. Stopping the supervisor as well remains a precondition: the
# lock stops a restarted writer from indexing, not from starting.
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
# Observation only, and it says so. `psql -c` opens a session, takes the lock
# and closes, which releases it, so this reports whether leadership was held at
# one instant. --apply does not rely on it; it takes the lock and keeps it.
LEADER_HELD=$("${Q[@]}" "SELECT NOT pg_try_advisory_lock($LOCK_ID);")
LEADER_APPS=$("${Q[@]}" "SELECT string_agg(DISTINCT application_name, ', ') FROM pg_stat_activity
              WHERE application_name LIKE 'midgard-explorer-l1-indexer%';")
echo "  leadership held (at this instant) = $([ "$LEADER_HELD" = "t" ] && echo YES || echo no)${LEADER_APPS:+  ($LEADER_APPS)}"

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

# Preflight, and more than a preflight.
#
# The migration resets the cursors, and a writer still running will re-index
# against a schema it was not built for, from a cursor that moved under it.
# Asking `pg_try_advisory_lock` in a one-shot `psql -c` and then migrating is
# not enough: that session closes, the lock goes with it, and a supervised
# writer can be restarted into the window between the answer and the migration.
# The check proved leadership was free at an instant; it reserved nothing.
#
# So this TAKES leadership and holds it, on a session that stays open across
# `indexer:deploy`. A restarting writer then finds the lock held, does not
# index, and retries, which is exactly what the lock is for. psql is started
# directly rather than inside a subshell, because killing a subshell does not
# kill the psql inside it and the lock would outlive the script.
# The holder session is fed from a FIFO and does nothing between statements, so
# it is IDLE rather than busy. That is the whole design: holding the session
# open with `SELECT pg_sleep(1800)` looked equivalent and was not. Killing psql
# closes the socket, but PostgreSQL only notices a gone client when the backend
# next tries to write, and a backend inside pg_sleep is not going to for half an
# hour. Rehearsed and measured: psql was gone, `pg_stat_activity` still showed
# the session `active` on `pg_sleep(1800)`, and the lock was still held.
#
# An idle backend, by contrast, is reading from its socket, so it sees EOF
# immediately. Closing fd 9 ends the session and releases the lock at once, and
# because the kernel closes fds when a process dies, that happens even if this
# script is SIGKILLed. No timeout is needed and none is used.
LOCK_LOG=$(mktemp)
LOCK_FIFO=$(mktemp -u)
mkfifo "$LOCK_FIFO"
# Opened read-write. `exec 9>fifo` blocks until a reader appears, and the reader
# is started on the next line, so a plain write open deadlocks against itself.
# Read-write never blocks, and psql still sees EOF when this fd closes, because
# EOF is "no writers left" and this is the only one.
exec 9<>"$LOCK_FIFO"
# `9>&-` matters more than it looks. Without it psql inherits fd 9, so psql is
# itself a writer on the FIFO it is reading, EOF can never arrive, and the
# session outlives the script: a SIGKILLed rollout left leadership held on a
# database with no process visibly holding it. Measured, not theorised. Closing
# the fd in the child is what makes "the writer dies, the lock goes" true.
psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -X -A -t -q -f "$LOCK_FIFO" \
  9>&- > "$LOCK_LOG" 2>&1 &
LOCK_PID=$!
release_lock() {
  # Both, deliberately. Closing the fd is the mechanism that works when this
  # script is SIGKILLed and no trap runs at all: the kernel closes the fd, psql
  # reads EOF and exits. Killing psql is the mechanism that works when the shell
  # is blocked somewhere the trap cannot promptly reach. Either one alone leaves
  # a case where leadership outlives the rollout, and neither is expensive.
  #
  # This is only safe because the session is IDLE. A backend killed mid-pg_sleep
  # keeps running and keeps the lock; an idle one ends immediately.
  exec 9>&- 2>/dev/null || true
  kill "$LOCK_PID" 2>/dev/null || true
  wait "$LOCK_PID" 2>/dev/null || true
  rm -f "$LOCK_FIFO" "$LOCK_LOG"
}
trap release_lock EXIT INT TERM

printf "SET application_name = 'midgard-explorer-rollout-lock';\n" >&9
printf "SELECT pg_try_advisory_lock(%s);\n" "$LOCK_ID" >&9

# Confirmed from a SEPARATE session against pg_locks, not by parsing the
# holder's own output: what matters is that the server records the lock as
# granted to that session, which is the thing a restarting writer will collide
# with.
LOCK_TAKEN=no
for _ in $(seq 1 100); do
  if [ "$("${Q[@]}" "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
           WHERE l.locktype = 'advisory' AND l.granted
             AND a.application_name = 'midgard-explorer-rollout-lock';")" = "1" ]; then
    LOCK_TAKEN=yes
    break
  fi
  sleep 0.1
done
if [ "$LOCK_TAKEN" != "yes" ]; then
  echo
  echo "REFUSING: could not take indexer leadership on $TARGET."
  echo "A writer holds it, or the connection failed: $(head -3 "$LOCK_LOG" | tr '\n' ' ')"
  echo "Stop the writer AND its supervisor, so it cannot restart, then re-run."
  exit 1
fi
echo
echo "Holding indexer leadership for this migration, on an idle session named"
echo "'midgard-explorer-rollout-lock'. A writer that restarts now will find the"
echo "lock held and will not index. It is released the moment this script ends."

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
echo "  Its supervisor must be stopped too, not just the process:"
echo "  leadership is held for this migration, so a restart cannot"
echo "  index, but it will also not be the one writer you wanted."
echo "=============================================================="
# The full host:port/database, not the database name alone. Two hosts commonly
# carry the same database name, and naming only the database is exactly the
# confirmation that cannot tell them apart.
read -r -p "Type $TARGET to continue: " CONFIRM
[ "$CONFIRM" = "$TARGET" ] || { echo "aborted"; exit 1; }

# Also without fd 9, so the migration cannot keep the holder alive after this
# script is gone.
pnpm indexer:deploy 9>&-
# Released here rather than left to the trap, so the window in which this script
# holds leadership is the migration and nothing after it.
release_lock
trap - EXIT INT TERM
echo
echo "  leadership released, advisory locks now on $DB = $("${Q[@]}" \
  "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory';")"
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
