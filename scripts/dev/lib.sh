#!/usr/bin/env bash
# Shared helpers for the `dev` command. Sourced, never executed.

set -euo pipefail

DEV_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV_STATE_ROOT="$DEV_REPO_ROOT/.dev"

# Colour only when a terminal is attached, so redirected output and CI logs stay
# readable as plain text.
if [[ -t 1 ]]; then
  DEV_BOLD=$'\033[1m'; DEV_RED=$'\033[31m'; DEV_YELLOW=$'\033[33m'; DEV_OFF=$'\033[0m'
else
  DEV_BOLD=""; DEV_RED=""; DEV_YELLOW=""; DEV_OFF=""
fi

say()  { printf '%s\n' "$*"; }
step() { printf '%s%s%s\n' "$DEV_BOLD" "$*" "$DEV_OFF"; }
warn() { printf '%s%s%s\n' "$DEV_YELLOW" "$*" "$DEV_OFF" >&2; }

# Every failure names its cause and the next command to run. A message without a
# second line leaves the reader where the error found them.
die() {
  printf '%s%s%s\n' "$DEV_RED" "$1" "$DEV_OFF" >&2
  [[ $# -gt 1 ]] && printf '  %s\n' "$2" >&2
  exit 1
}

node_helper() { node "$DEV_REPO_ROOT/scripts/dev/net.mjs" "$@"; }

# --- requirements -----------------------------------------------------------

require_node() {
  command -v node >/dev/null 2>&1 ||
    die "Node is not installed." "Install Node 24, the version .nvmrc pins."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major < 24 )); then
    die "Node $major is too old for frontend-new, which requires 24." \
        "Run: nvm use 24"
  fi
}

require_pnpm() {
  command -v pnpm >/dev/null 2>&1 ||
    die "pnpm is not on PATH." "Run: corepack enable"
  local major
  major="$(pnpm --version | cut -d. -f1)"
  if [[ "$major" != "11" ]]; then
    warn "pnpm $major is on PATH; this repository pins 11. Run: corepack enable"
  fi
}

# The install is skipped when it has already happened, so `up` stays idempotent
# and a second run does not pay for a dependency graph that has not changed.
ensure_frontend_install() {
  if [[ -d "$DEV_REPO_ROOT/frontend-new/node_modules" &&
        -d "$DEV_REPO_ROOT/frontend-new/app/node_modules" ]]; then
    return 0
  fi
  step "Installing frontend-new dependencies"
  (cd "$DEV_REPO_ROOT/frontend-new" && pnpm install --frozen-lockfile) ||
    die "pnpm install failed in frontend-new." \
        "Read the output above, then run: cd frontend-new && pnpm install"
}

# --- process control --------------------------------------------------------

pid_alive() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }

# Stops a service by the pid this command recorded, and nothing else.
#
# Only descendants of that pid are signalled. A pattern match over the process
# table is how a stop command ends up killing an unrelated dev server, or its
# own shell. `next dev` spawns workers that hold the port after the parent is
# gone, so the descendants have to go too: killing the process group covers them
# where setsid started one, and a walk down `pgrep -P` covers the rest.
stop_tree() {
  local pid="$1"
  pid_alive "$pid" || return 0

  local group
  group="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$group" && "$group" == "$pid" ]]; then
    kill -TERM "-$group" 2>/dev/null || true
  else
    local descendants=()
    collect_descendants "$pid" descendants
    kill -TERM "${descendants[@]}" 2>/dev/null || true
  fi

  for _ in $(seq 1 50); do
    pid_alive "$pid" || return 0
    sleep 0.1
  done
  kill -KILL "$pid" 2>/dev/null || true
}

collect_descendants() {
  local pid="$1" out="$2" child
  eval "$out+=($pid)"
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    collect_descendants "$child" "$out"
  done
}

# Runs a service detached and records the pid the stop path will use.
#
# `exec` replaces the subshell, so the recorded pid is the service itself rather
# than a wrapper that exits immediately and leaves the real process unaddressed.
# `nohup` keeps it alive when the launching shell goes away, and stdin is closed
# because a detached dev server that reads stdin blocks forever.
start_service() {
  local name="$1" dir="$2" log="$3"; shift 3
  local pid_file="$DEV_MODE_STATE/$name.pid"
  : >"$log"
  (cd "$dir" && exec nohup "$@" </dev/null >>"$log" 2>&1) &
  printf '%s\n' "$!" >"$pid_file"
}

# Next allows one dev server per project directory, whatever port each is given,
# so a free port does not mean the app can start. Reported before anything is
# launched, because the failure otherwise arrives three minutes later as a
# timeout that names the wrong cause.
#
# Shared by both modes rather than owned by demo. They compete for the same
# directory, so `up existing` while demo is running is the same conflict seen
# from the other side, and each mode stops its own processes before reaching
# here: a lock still held at this point is somebody else's.
#
# The other server is not stopped. It belongs to whoever started it, and it is
# serving whatever their .env.local points at, so adopting it would fill this
# mode with data from somewhere else.
require_no_foreign_dev_server() {
  local lock
  lock="$(node_helper dev-lock "$DEV_REPO_ROOT/frontend-new/app" 2>/dev/null)" || return 0
  local pid="${lock%% *}" url="${lock#* }"
  local hint="This mode needs that directory. Stop it with: kill $pid"
  for other in demo existing; do
    if [[ "$(cat "$DEV_STATE_ROOT/$other/app.pid" 2>/dev/null || true)" == "$pid" ]]; then
      hint="That is $other mode. Stop it with: ./dev down"
    fi
  done
  die "A Next dev server for frontend-new/app is already running on $url (pid $pid)." "$hint"
}

# --- state ------------------------------------------------------------------

state_file() { printf '%s\n' "$DEV_MODE_STATE/state.env"; }

load_state() {
  local file; file="$(state_file)"
  [[ -f "$file" ]] || return 1
  # shellcheck disable=SC1090
  source "$file"
}

read_pid() {
  local file="$DEV_MODE_STATE/$1.pid"
  [[ -f "$file" ]] && cat "$file" || true
}
