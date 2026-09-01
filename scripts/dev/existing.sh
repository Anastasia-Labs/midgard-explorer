#!/usr/bin/env bash
# Existing-node mode: the explorer against a Midgard database that already
# holds data.
#
# Starts the explorer's own PostgreSQL and API cache, applies the index
# migrations, then the backend and frontend-new. It does not start midgard-node,
# Cardano Node, Kupo or Ogmios, and it does not need them: L2 blocks,
# transactions, addresses and UTxOs are read from the node's own tables.
#
# The L1 indexer stays off. Readiness is the L2 scope, which ADR 3 records as
# development-only; `/readyz` is unchanged and still answers the full question.
#
# Nothing here deletes a volume, a database or any Midgard state.
#
# Sourced by `dev`, which has already sourced lib.sh.

DEV_MODE_STATE_EXISTING="$DEV_STATE_ROOT/existing"

# Container ownership, adoption and the migration guard live in
# backend/scripts/lib/compose.mjs. `pnpm dev` in the backend package and this
# command are two entry points to one implementation, so neither can drift into
# a second answer about which database may be migrated or which container may
# be stopped.
compose_lib() { node "$DEV_REPO_ROOT/backend/scripts/lib/compose.mjs" "$DEV_REPO_ROOT" "$@"; }
adopted_record() { printf '%s\n' "$DEV_STATE_ROOT/existing/adopted"; }
existing_load_runtime() {
  local file="$DEV_STATE_ROOT/runtime.env"
  [[ -f "$file" ]] ||
    die "No .dev/runtime.env." "Run: ./dev setup existing"
  local assignments
  assignments="$(node "$DEV_REPO_ROOT/backend/scripts/lib/env.mjs" shell \
    "$file" "$DEV_REPO_ROOT/backend/.env")" ||
    die ".dev/runtime.env does not carry what this mode needs." \
        "The lines above name each one. Fix them there, then: ./dev setup existing --force"
  eval "$assignments"
  EXISTING_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
  EXISTING_API_URL="http://127.0.0.1:$API_CACHE_PORT"
  EXISTING_APP_URL="http://127.0.0.1:$FRONTEND_PORT"
}

# The one database this command migrates.
#
# ADR 3 records the rule: `dev` migrates a database it created, on a local
# Docker service this repository defines. That was a comment above the migrate
# step and nothing else, so a backend/.env pointing at a shared index had it
# migrated by a command whose job was to start a development server.
#
# Ownership is established rather than asserted. `docker compose port` answers
# with the address the running container publishes, so an index URL that
# resolves anywhere else is not this service, whatever it has been named.
#
# The URL checked is the one the migration will read, not the one .dev/runtime.env
# happens to hold. `prisma.indexer.config.ts` loads backend/.env and leaves an
# existing process variable alone, so a local runtime.env beside a remote
# backend/.env used to pass this and migrate the remote database.
# Which running containers this command must leave alone when it stops.
#
# A container is adopted when the run that first met it found it already
# running. On a restart that answer carries forward rather than being taken
# again: by then `dev` has started them itself, so asking "what is running?"
# a second time would call everything adopted and `down` would leave behind
# exactly what `up` started.
existing_compose() {
  docker compose --project-directory "$DEV_REPO_ROOT" \
    -f "$DEV_REPO_ROOT/docker-compose.yml" \
    --env-file "$DEV_STATE_ROOT/runtime.env" "$@"
}

existing_port_free_or_ours() {
  local port="$1" name="$2" pid
  node_helper free-port "$port" 1 >/dev/null 2>&1 && return 0
  pid="$(read_pid "$name" 2>/dev/null || true)"
  [[ -n "$pid" ]] && pid_alive "$pid" && return 0
  die "Port $port is in use, and $name did not start it." \
      "Free it, or change ${3} in .dev/runtime.env and run: ./dev setup existing --force"
}

# Whether this run indexes Cardano as well as reading the node's database.
# Off by default: indexing reaches Koios over the network and takes as long as
# the chain is long, and a contributor reading L2 records does not need it.
EXISTING_WITH_L1_SYNC=0

existing_up() {
  for arg in "$@"; do
    case "$arg" in
      --with-l1-sync) EXISTING_WITH_L1_SYNC=1 ;;
      *) die "Unknown option: $arg" "Use: ./dev up existing [--with-l1-sync]" ;;
    esac
  done

  require_node
  require_pnpm
  existing_load_runtime

  DEV_MODE_STATE="$DEV_MODE_STATE_EXISTING"
  mkdir -p "$DEV_MODE_STATE"

  # A second `up` is a restart, not a conflict. Without this, the run before it
  # is still holding the ports and the Next lock, and the command reports its
  # own server as somebody else's.
  existing_stop_processes

  # Recorded before every check that can stop this run, and before anything is
  # started, so a startup that dies at a port conflict or a missing manifest
  # still leaves `down` able to tell a container it found from one it started.
  EXISTING_ADOPTED="$(compose_lib record-adoption 2>/dev/null || true)"

  [[ -f "$DEV_REPO_ROOT/backend/.env" ]] ||
    die "backend/.env does not exist." "Run: ./dev setup existing"
  [[ -d "$DEV_REPO_ROOT/backend/node_modules" ]] ||
    die "backend dependencies are not installed." "Run: cd backend && pnpm install"
  ensure_frontend_install

  if (( EXISTING_WITH_L1_SYNC )); then
    # Indexing without these produces rows attributed to nothing, which no
    # query can reach. Checked before a process starts rather than after it
    # has written some.
    [[ -n "${MIDGARD_MANIFEST_PATH:-}" && -f "$MIDGARD_MANIFEST_PATH" ]] ||
      die "--with-l1-sync needs a deployment manifest, and MIDGARD_MANIFEST_PATH names no file." \
          "A Midgard deployment has no on-chain identifier: the manifest says which contracts to follow."
    [[ -n "${KOIOS_BASE_URL:-}" ]] ||
      die "--with-l1-sync needs KOIOS_BASE_URL." "Set it in .dev/runtime.env"
  fi

  existing_port_free_or_ours "$BACKEND_PORT" backend BACKEND_PORT
  existing_port_free_or_ours "$FRONTEND_PORT" app FRONTEND_PORT

  require_no_foreign_dev_server

  step "Starting the explorer's own PostgreSQL and API cache"
  # `up -d` adopts what is already running. Nothing is removed, and no volume is
  # touched: the index outlives every run of this command.
  existing_compose up -d explorer-postgres explorer-api-cache >/dev/null 2>&1 ||
    die "docker compose could not start explorer-postgres and explorer-api-cache." \
        "Run it directly to see why: docker compose --env-file .dev/runtime.env up explorer-postgres"
  say "  explorer-postgres and explorer-api-cache are up"
  [[ -n "${EXISTING_ADOPTED:-}" ]] &&
    say "  adopted, and will be left running: $EXISTING_ADOPTED"

  step "Applying the index migrations"
  compose_lib assert-owned ||
    die "Refusing to migrate an index \`dev\` does not own." \
        "Migrate it through the rollout instead: cd backend && ./scripts/rollout.sh --apply"
  (cd "$DEV_REPO_ROOT/backend" && pnpm --silent indexer:deploy >/dev/null 2>&1) ||
    die "The index migrations did not apply." \
        "Run: cd backend && pnpm indexer:deploy"
  say "  index schema is current"

  step "Starting the backend"
  # `dev:server`, not `dev`. This command has already started the containers,
  # checked ownership, migrated and probed readiness; `pnpm dev` would do all of
  # that again, and its own answer about whether to index would overwrite the
  # one decided here, silently turning --with-l1-sync off.
  #
  # Exactly one indexer. The index is written by one process and read by all of
  # them, and the writer takes an advisory lock, so a second one started here
  # would simply not index while looking like it was.
  #
  # When indexing, the manifest this run checked is the one the process reads.
  # Leaving it to backend/.env meant the preflight above validated one path
  # while the backend opened another, and a drifted pair failed at boot rather
  # than here, where the message can name the file.
  if (( EXISTING_WITH_L1_SYNC )); then
    BACKEND_PORT="$BACKEND_PORT" L1_SYNC_ENABLED=true \
    MIDGARD_MANIFEST_PATH="$MIDGARD_MANIFEST_PATH" \
      start_service backend "$DEV_REPO_ROOT/backend" \
        "$DEV_MODE_STATE/backend.log" pnpm --silent dev:server
  else
    BACKEND_PORT="$BACKEND_PORT" L1_SYNC_ENABLED=false \
      start_service backend "$DEV_REPO_ROOT/backend" \
        "$DEV_MODE_STATE/backend.log" pnpm --silent dev:server
  fi

  node_helper wait-health "$EXISTING_BACKEND_URL" 90000 ||
    die "The backend did not answer on $EXISTING_BACKEND_URL." \
        "Read: ./dev logs backend"
  say "  listening on $EXISTING_BACKEND_URL"

  # The flag goes into the advice too. Without it the command suggested here
  # runs the L2 scope, which cannot see the reconciliation that just failed and
  # would answer Ready.
  local doctor_flag=""
  (( EXISTING_WITH_L1_SYNC )) && doctor_flag=" --with-l1-sync"
  step "Checking it can serve L2 reads"
  local scope_output
  if scope_output="$(cd "$DEV_REPO_ROOT/backend" && pnpm --silent readiness -- --scope=l2 2>&1)"; then
    say "  node database and index are ready for L2 reads"
  else
    printf '%s\n' "$scope_output" | sed -n 's/^NOT READY/  NOT READY/p'
    die "The explorer cannot serve L2 reads yet." \
        "The lines above name the probe that failed. Run: ./dev doctor existing$doctor_flag"
  fi

  step "Starting frontend-new"
  NEXT_PUBLIC_API_BASE="$EXISTING_API_URL" \
  API_BASE_SERVER="$EXISTING_API_URL" \
    start_service app "$DEV_REPO_ROOT/frontend-new" \
      "$DEV_MODE_STATE/app.log" \
      pnpm --filter @midgard-explorer/app exec next dev \
        --hostname 127.0.0.1 --port "$FRONTEND_PORT"

  node_helper wait-app "$EXISTING_APP_URL" 180000 ||
    die "The explorer did not serve the overview page on $EXISTING_APP_URL." \
        "Read: ./dev logs app"

  # Quoted on the way in. These are values this command derived rather than
  # values a person typed, and they are still written for a shell to read.
  cat >"$(state_file)" <<STATE
EXISTING_APP_URL='$EXISTING_APP_URL'
EXISTING_API_URL='$EXISTING_API_URL'
EXISTING_BACKEND_URL='$EXISTING_BACKEND_URL'
EXISTING_WITH_L1_SYNC='$EXISTING_WITH_L1_SYNC'
STATE

  existing_print
  (( EXISTING_WITH_L1_SYNC )) && existing_await_strict_readiness
  return 0
}

# Waits for what `/readyz` answers, printing the cursors as they move.
#
# No value is ever written here. A cursor is written only inside a pass where
# every source completed, which is what makes the three heights a record of a
# finished reconciliation rather than a progress bar, and seeding one would
# turn readiness into a claim nobody checked.
existing_await_strict_readiness() {
  say ""
  step "Indexing Cardano. Waiting for strict readiness"
  say "  This reaches Koios over the network and takes as long as the gap is wide."
  say "  Stop waiting at any time with Ctrl-C; the indexer keeps running."
  local deadline=$(( SECONDS + 3600 )) last=""
  while (( SECONDS < deadline )); do
    if node_helper ready-check "$EXISTING_BACKEND_URL" >/dev/null 2>&1; then
      local final; final="$(node_helper sync-state "$EXISTING_API_URL" 2>/dev/null || true)"
      say "  reconciled: $final"
      say ""
      printf 'Status:    serving L1 and L2, strict readiness met\n'
      return 0
    fi
    local now; now="$(node_helper sync-state "$EXISTING_API_URL" 2>/dev/null || true)"
    if [[ -n "$now" && "$now" != "$last" ]]; then
      say "  $now"
      last="$now"
    fi
    sleep 10
  done
  warn "Strict readiness was not reached within an hour."
  warn "What failed: $(node_helper ready-check "$EXISTING_BACKEND_URL" 2>&1 || true)"
  warn "Why: ./dev doctor existing --with-l1-sync. The backend log holds the driver message."
  return 1
}

existing_print() {
  say ""
  printf 'Explorer:  %s\n' "$EXISTING_APP_URL"
  printf 'API:       %s\n' "$EXISTING_API_URL"
  printf 'Status:    serving L2 reads\n'
  printf 'Mode:      existing Midgard database\n'
  say ""
  if (( EXISTING_WITH_L1_SYNC )); then
    say "The Cardano L1 index is being updated. L1 pages fill in as the cursors"
    say "move, and strict readiness is met once every source has completed a pass."
  else
    say "The Cardano L1 index is not being updated in this run, so L1 pages show"
    say "what the index already holds and say so. Add --with-l1-sync to index."
  fi
  say "Logs: ./dev logs backend   Stop: ./dev down"
}

existing_status() {
  DEV_MODE_STATE="$DEV_MODE_STATE_EXISTING"
  if ! load_state 2>/dev/null; then
    say "Mode:      existing (not running)"
    say "Start it:  ./dev up existing"
    return 0
  fi
  if [[ "${1:-}" == "--watch" ]]; then
    while true; do
      existing_status_once
      say ""
      sleep 10
    done
  fi
  existing_status_once
}

existing_status_once() {
  printf 'Explorer:  %s  %s\n' "$EXISTING_APP_URL" "$(demo_probe app "$EXISTING_APP_URL")"
  printf 'Backend:   %s  %s\n' "$EXISTING_BACKEND_URL" "$(existing_probe_backend)"
  local sync; sync="$(node_helper sync-state "$EXISTING_API_URL" 2>/dev/null || echo "unreadable")"
  printf 'L1 index:  %s\n' "$sync"
  if node_helper ready-check "$EXISTING_BACKEND_URL" >/dev/null 2>&1; then
    printf 'Readiness: strict readiness met\n'
  else
    printf 'Readiness: %s\n' "$(node_helper ready-check "$EXISTING_BACKEND_URL" 2>&1 || true)"
  fi
  printf 'Indexing:  %s\n' "$( [[ "${EXISTING_WITH_L1_SYNC:-0}" == "1" ]] && echo "on" || echo "off" )"
}

existing_probe_backend() {
  local pid; pid="$(read_pid backend)"
  if ! pid_alive "$pid"; then printf 'stopped'; return 0; fi
  if node_helper check-health "$EXISTING_BACKEND_URL" >/dev/null 2>&1; then
    printf 'healthy (pid %s)' "$pid"
  else
    printf 'pid %s is up but /healthz does not answer' "$pid"
  fi
}

# Stops the processes this mode started, and nothing about Docker. Shared by
# `down` and by `up`, which restarts rather than refusing when one is already up.
existing_stop_processes() {
  local pid
  for name in app backend; do
    pid="$(read_pid "$name")"
    [[ -n "$pid" ]] && stop_tree "$pid"
    rm -f "$DEV_MODE_STATE/$name.pid"
  done
  rm -f "$DEV_MODE_STATE/state.env"
}

existing_down() {
  DEV_MODE_STATE="$DEV_MODE_STATE_EXISTING"
  mkdir -p "$DEV_MODE_STATE"
  step "Stopping existing mode"
  existing_stop_processes
  # `stop`, never `down`. `down` removes containers, and `down -v` removes the
  # volume holding the index: weeks of Cardano indexing, gone to a stop command.
  #
  # And only what this command started. A container that was already up belongs
  # to whoever started it, and stopping it is a side effect of `./dev down` that
  # nobody asked for.
  if [[ -f "$DEV_STATE_ROOT/runtime.env" ]]; then
    local stopped adopted adopted_out
    adopted_out="$DEV_MODE_STATE/.adopted-report"
    # A helper that cannot run is not a helper that found nothing. Reporting
    # "none to stop" on a failed call is the same false green this command
    # exists to avoid, so the two are told apart.
    if ! stopped="$(compose_lib stop-unowned 2>"$adopted_out")"; then
      warn "Could not work out which containers this command started."
      warn "Nothing was stopped. Read: cat $(adopted_record)"
      rm -f "$adopted_out"
      return 1
    fi
    adopted="$(cat "$adopted_out" 2>/dev/null || true)"
    rm -f "$adopted_out"
    if [[ "$stopped" == "none" ]]; then
      say "  no containers were started by this command, so none are stopped"
    else
      [[ -n "$stopped" ]] && say "  stopped: $stopped"
      [[ -n "$adopted" ]] &&
        say "  left running, because \`up\` found them already started: $adopted"
    fi
  fi
  say "Stopped. No volume, database or Midgard state was removed."
}

existing_logs() {
  DEV_MODE_STATE="$DEV_MODE_STATE_EXISTING"
  local which="${1:-all}" follow="${2:-}"
  local files=()
  case "$which" in
    all) files=("$DEV_MODE_STATE/backend.log" "$DEV_MODE_STATE/app.log") ;;
    backend|app) files=("$DEV_MODE_STATE/$which.log") ;;
    *) die "Unknown service: $which" "Use: ./dev logs [backend|app]" ;;
  esac
  for file in "${files[@]}"; do
    [[ -f "$file" ]] || die "No log at $file." "Start it first: ./dev up existing"
  done
  if [[ "$follow" == "--follow" || "$follow" == "-f" ]]; then
    tail -n 40 -f "${files[@]}"
  else
    tail -n 40 "${files[@]}"
  fi
}
