#!/usr/bin/env bash
# Demo mode: the fixture API and frontend-new, and nothing else.
#
# No Docker, no database, no secrets, no Midgard and no Cardano. The fixture
# backend serves the same routes as the real API from committed data, so the
# whole explorer can be reviewed and developed from a clean clone.
#
# Sourced by `dev`, which has already sourced lib.sh.

DEV_MODE=demo
DEV_MODE_STATE="$DEV_STATE_ROOT/demo"

# Preferred ports, scanned upward when taken. Deliberately clear of the ports
# this stack already coordinates: 3000 (node), 3100 (Loki), 3101 (backend),
# 3102 (API cache), 3210 and 3211 (the e2e suite, which must stay runnable
# while demo mode is up).
readonly DEMO_APP_PREFERRED=3010
readonly DEMO_FIXTURE_PREFERRED=3110

# The API base has to be 127.0.0.1 rather than localhost: the fixture listens on
# IPv4 only, and localhost resolves to ::1 first on many machines, which fails
# every request the browser makes.
demo_urls() {
  DEMO_APP_URL="http://127.0.0.1:$DEMO_APP_PORT"
  DEMO_FIXTURE_URL="http://127.0.0.1:$DEMO_FIXTURE_PORT"
}

demo_running() {
  load_state 2>/dev/null || return 1
  demo_urls
  pid_alive "$(read_pid demo)" || return 1
  node_helper check-fixture "$DEMO_FIXTURE_URL" >/dev/null 2>&1 || return 1
  node_helper check-app "$DEMO_APP_URL" >/dev/null 2>&1 || return 1
}

demo_print_urls() {
  say ""
  printf 'Explorer:  %s\n' "$DEMO_APP_URL"
  printf 'API:       %s\n' "$DEMO_FIXTURE_URL"
  printf 'Status:    healthy\n'
  printf 'Mode:      demo data\n'
  say ""
  say "The records shown are fixture data, not a Midgard deployment."
  say "Logs: ./dev logs    Stop: ./dev down"
}

demo_up() {
  require_node
  require_pnpm

  mkdir -p "$DEV_MODE_STATE"

  if demo_running; then
    step "Demo mode is already running"
    demo_print_urls
    return 0
  fi

  # A recorded pid that is gone, or a half-started pair, leaves state behind.
  # Clearing it is what makes a second `up` after a crash behave like the first.
  demo_down_quiet

  demo_require_no_foreign_dev_server

  ensure_frontend_install

  # The mode itself is `pnpm dev:demo` in frontend-new: it selects the ports,
  # starts the fixture, verifies its identity and starts Next. This command runs
  # that in the background and records the pid, which is the only thing it adds.
  # Two implementations of the same startup would drift, and the one nobody runs
  # by hand would be the one that broke.
  step "Starting demo mode"
  start_service demo "$DEV_REPO_ROOT/frontend-new/app" \
    "$DEV_MODE_STATE/demo.log" node scripts/dev-demo.mjs

  local deadline=$(( SECONDS + 200 ))
  while (( SECONDS < deadline )); do
    if grep -q "^Explorer on " "$DEV_MODE_STATE/demo.log" 2>/dev/null; then break; fi
    pid_alive "$(read_pid demo)" ||
      die "Demo mode stopped while starting." "Read: ./dev logs"
    sleep 1
  done

  DEMO_APP_PORT="$(sed -n 's#^Explorer on http://127.0.0.1:\([0-9]*\)$#\1#p' "$DEV_MODE_STATE/demo.log" | head -1)"
  DEMO_FIXTURE_PORT="$(sed -n 's#^Fixture API on http://127.0.0.1:\([0-9]*\)$#\1#p' "$DEV_MODE_STATE/demo.log" | head -1)"
  [[ -n "$DEMO_APP_PORT" && -n "$DEMO_FIXTURE_PORT" ]] ||
    die "Demo mode did not report its ports." "Read: ./dev logs"
  demo_urls
  say "  explorer   $DEMO_APP_PORT"
  say "  fixture    $DEMO_FIXTURE_PORT"

  cat >"$(state_file)" <<STATE
DEMO_APP_PORT=$DEMO_APP_PORT
DEMO_FIXTURE_PORT=$DEMO_FIXTURE_PORT
STATE

  # A first compile on a small machine is slow, and the budget has to cover it
  # rather than report the machine as a failure.
  node_helper wait-app "$DEMO_APP_URL" 180000 ||
    die "The explorer did not serve the overview page on $DEMO_APP_URL." \
        "Read: ./dev logs. A bundler worker that misses its deadline reports a
  Turbopack panic here; it has been seen on this stack only with memory
  exhausted, so check \`free -m\` before reading it as a code failure."

  demo_print_urls
}

# Next allows one dev server per project directory, whatever port each is given,
# so a free port does not mean the app can start. Reported before anything is
# launched, because the failure otherwise arrives three minutes later as a
# timeout that names the wrong cause.
#
# The other server is not stopped here. It belongs to whoever started it, and it
# is serving whatever their .env.local points at rather than the fixture, so
# adopting it would fill demo mode with data from somewhere else.
demo_require_no_foreign_dev_server() {
  local lock
  lock="$(node_helper dev-lock "$DEV_REPO_ROOT/frontend-new/app" 2>/dev/null)" || return 0
  local pid="${lock%% *}" url="${lock#* }"
  die "A Next dev server for frontend-new/app is already running on $url (pid $pid)." \
      "Demo mode needs that directory. Stop it with: kill $pid"
}

demo_down_quiet() {
  local pid
  for name in demo app fixture; do
    pid="$(read_pid "$name")"
    [[ -n "$pid" ]] && stop_tree "$pid"
    rm -f "$DEV_MODE_STATE/$name.pid"
  done
  rm -f "$DEV_MODE_STATE/state.env"
}

demo_down() {
  mkdir -p "$DEV_MODE_STATE"
  if [[ ! -f "$(state_file)" ]] && [[ -z "$(read_pid demo)" ]]; then
    say "Demo mode is not running."
    return 0
  fi
  step "Stopping demo mode"
  demo_down_quiet
  say "Stopped. Nothing was deleted: demo mode owns no database and no volume."
}

demo_status() {
  if ! load_state 2>/dev/null; then
    say "Mode:      demo (not running)"
    say "Start it:  ./dev up demo"
    return 0
  fi
  demo_urls

  local app_state fixture_state
  fixture_state="$(demo_probe demo "$DEMO_FIXTURE_URL" check-fixture)"
  app_state="$(demo_probe demo "$DEMO_APP_URL")"

  printf 'Explorer:  %s  %s\n' "$DEMO_APP_URL" "$app_state"
  printf 'API:       %s  %s\n' "$DEMO_FIXTURE_URL" "$fixture_state"
  printf 'Mode:      demo data\n'
}

# Reports the process and the identity check separately: a live pid whose port
# answers as something else is a different problem from a dead one.
demo_probe() {
  local name="$1" url="$2" check="${3:-check-app}" pid
  pid="$(read_pid "$name")"
  if ! pid_alive "$pid"; then
    printf 'stopped'
    return 0
  fi
  local reason
  if reason="$(node_helper "$check" "$url" 2>&1)"; then
    printf 'healthy (pid %s)' "$pid"
  else
    printf 'pid %s is up but the port %s' "$pid" "$reason"
  fi
}

demo_logs() {
  # One log, because one process. The fixture and the app share a terminal when
  # `pnpm dev:demo` is run directly, and they share a file here.
  local follow="${2:-$1}"
  local file="$DEV_MODE_STATE/demo.log"
  [[ -f "$file" ]] || die "No log at $file." "Start it first: ./dev up demo"
  if [[ "$follow" == "--follow" || "$follow" == "-f" ]]; then
    tail -n 40 -f "$file"
  else
    tail -n 40 "$file"
  fi
}
