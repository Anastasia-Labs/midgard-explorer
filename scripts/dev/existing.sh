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

# Which containers `up` found already running. Separate from state.env: run
# state describes a startup that completed, and this describes what this command
# is not allowed to stop, which is decided before the startup can fail.
#
# Its absence is meaningful. The record is written before `compose up -d`, so a
# missing one means this command never started a container, and `down` stops
# none.
adopted_file() { printf '%s\n' "$DEV_MODE_STATE_EXISTING/adopted"; }

# Asks Docker what is already running and writes the answer down.
#
# On a restart the answer carries forward instead of being taken again: a
# container is adopted only if the run that first found it said so, and it is
# still running. Anything else is one `dev` started and still owns.
#
# Nothing is written when Docker cannot be asked. A guess recorded as an answer
# is how a container somebody else started gets stopped by `./dev down`.
existing_record_adoption() {
  local had_previous="$1" previous="$2" running_now
  running_now="$(existing_compose ps --services --filter status=running 2>/dev/null | tr '\n' ' ')" ||
    return 0
  EXISTING_ADOPTED="$(existing_adoption "$had_previous" "$previous" "$running_now")"
  printf '%s' "$EXISTING_ADOPTED" >"$(adopted_file)"
}

# Reads .dev/runtime.env, and never sources it.
#
# That file is a dotenv file whose generator quotes nothing, and whose values
# include a database password and a path a person typed. Sourcing it made every
# one of them shell code: a manifest path holding a space would be word-split,
# and one holding $(...) would run. env.mjs parses it, validates a fixed
# whitelist, and prints those values quoted, so what reaches this shell is a
# known set of names carrying data rather than a file carrying instructions.
#
# Ports are not selected automatically here. They are coordinated with services
# this repository does not own, and NEXT_PUBLIC_API_BASE is read at build time,
# so a silently reassigned port produces a frontend calling an origin nothing is
# listening on. A conflict is reported and the run stops.
existing_load_runtime() {
  local file="$DEV_STATE_ROOT/runtime.env"
  [[ -f "$file" ]] ||
    die "No .dev/runtime.env." "Run: ./dev setup existing"
  local assignments
  assignments="$(node "$DEV_REPO_ROOT/scripts/dev/env.mjs" shell \
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
existing_adoption() {
  local had_previous="$1" previous="$2" running="$3" adopted="" service
  for service in $running; do
    if (( had_previous )); then
      case " $previous " in
        *" $service "*) adopted+="$service " ;;
      esac
    else
      adopted+="$service "
    fi
  done
  printf '%s' "${adopted% }"
}

# Which of this repository's services a stop is allowed to touch.
#
# The complement of the adoption record: everything the record does not name is
# something this command started and therefore owns.
existing_services_to_stop() {
  local adopted="$1"; shift
  local service out=""
  for service in "$@"; do
    case " $adopted " in
      *" $service "*) continue ;;
    esac
    out+="$service "
  done
  printf '%s' "${out% }"
}

existing_assert_owned_index() {
  local published published_port
  published="$(existing_compose port explorer-postgres 5432 2>/dev/null | tr -d '[:space:]' || true)"
  published_port="${published##*:}"

  local wrong=()
  if [[ -z "$published_port" ]]; then
    wrong+=("explorer-postgres publishes no port, so nothing identifies it as this repository's database")
  elif [[ "$INDEX_URL_PORT" != "$published_port" ]]; then
    wrong+=("the index is on port $INDEX_URL_PORT; explorer-postgres publishes $published_port")
  fi
  case "$INDEX_URL_HOST" in
    127.0.0.1|localhost|::1) ;;
    *) wrong+=("the index is on $INDEX_URL_HOST, which is not this machine") ;;
  esac
  [[ "$INDEX_URL_DB" == "${EXPLORER_POSTGRES_DB:-}" ]] ||
    wrong+=("the index database is \"$INDEX_URL_DB\"; Compose provisions \"${EXPLORER_POSTGRES_DB:-}\"")
  [[ "$INDEX_URL_USER" == "${EXPLORER_POSTGRES_USER:-}" ]] ||
    wrong+=("the index user is \"$INDEX_URL_USER\"; Compose provisions \"${EXPLORER_POSTGRES_USER:-}\"")

  (( ${#wrong[@]} == 0 )) && return 0

  warn "INDEXER_POSTGRES_URL, from $INDEX_URL_SOURCE, does not name the database this repository provisions:"
  local reason
  for reason in "${wrong[@]}"; do warn "  $reason"; done
  die "Refusing to migrate an index \`dev\` does not own." \
      "Migrate it through the rollout instead: cd backend && ./scripts/rollout.sh --apply"
}

existing_compose() {
  docker compose --env-file "$DEV_STATE_ROOT/runtime.env" "$@"
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

  # What the previous run concluded about the containers.
  #
  # Kept in its own file rather than in state.env, because it outlives a run:
  # state.env records a startup that finished, and which containers this command
  # may stop is true from the moment it looks, whether or not the rest of the
  # startup then succeeds.
  local previous_adopted="" had_previous_state=0
  if [[ -f "$(adopted_file)" ]]; then
    previous_adopted="$(cat "$(adopted_file)")"
    had_previous_state=1
  fi

  # A second `up` is a restart, not a conflict. Without this, the run before it
  # is still holding the ports and the Next lock, and the command reports its
  # own server as somebody else's.
  existing_stop_processes

  # Written before every check that can stop this run, and before anything is
  # started, so a startup that dies at a port conflict or a missing manifest
  # still leaves `down` able to tell a container it found from one it started.
  existing_record_adoption "$had_previous_state" "$previous_adopted"

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
  existing_assert_owned_index
  (cd "$DEV_REPO_ROOT/backend" && pnpm --silent indexer:deploy >/dev/null 2>&1) ||
    die "The index migrations did not apply." \
        "Run: cd backend && pnpm indexer:deploy"
  say "  index schema is current"

  step "Starting the backend"
  # Exactly one indexer. The index is written by one process and read by all of
  # them, and the writer takes an advisory lock, so a second one started here
  # would simply not index while looking like it was.
  # When indexing, the manifest this run checked is the one the process reads.
  # Leaving it to backend/.env meant the preflight above validated one path
  # while the backend opened another, and a drifted pair failed at boot rather
  # than here, where the message can name the file.
  if (( EXISTING_WITH_L1_SYNC )); then
    BACKEND_PORT="$BACKEND_PORT" L1_SYNC_ENABLED=true \
    MIDGARD_MANIFEST_PATH="$MIDGARD_MANIFEST_PATH" \
      start_service backend "$DEV_REPO_ROOT/backend" \
        "$DEV_MODE_STATE/backend.log" pnpm --silent dev
  else
    BACKEND_PORT="$BACKEND_PORT" L1_SYNC_ENABLED=false \
      start_service backend "$DEV_REPO_ROOT/backend" \
        "$DEV_MODE_STATE/backend.log" pnpm --silent dev
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
  # Which containers were already running when `up` first looked. Present even
  # when that `up` failed part-way, which is when stopping the wrong container
  # would otherwise be easiest.
  local adopted="" started_anything=0
  if [[ -f "$(adopted_file)" ]]; then
    adopted="$(cat "$(adopted_file)")"
    started_anything=1
  fi
  step "Stopping existing mode"
  existing_stop_processes
  # `stop`, never `down`. `down` removes containers, and `down -v` removes the
  # volume holding the index: weeks of Cardano indexing, gone to a stop command.
  #
  # And only what this command started. A container that was already up belongs
  # to whoever started it, and stopping it is a side effect of `./dev down` that
  # nobody asked for.
  if (( started_anything == 0 )); then
    say "  no containers were started by this command, so none are stopped"
  elif [[ -f "$DEV_STATE_ROOT/runtime.env" ]]; then
    local stopped
    stopped="$(existing_services_to_stop "$adopted" explorer-postgres explorer-api-cache)"
    if [[ -n "$stopped" ]]; then
      # shellcheck disable=SC2086
      existing_compose stop $stopped >/dev/null 2>&1 || true
      say "  stopped: $stopped"
    fi
    if [[ -n "$adopted" ]]; then
      say "  left running, because \`up\` found them already started: $adopted"
    fi
  fi
  # Nothing is ours once everything we started is stopped, so the next `up`
  # decides again from what it finds.
  rm -f "$(adopted_file)"
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
