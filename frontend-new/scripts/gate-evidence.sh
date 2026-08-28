#!/usr/bin/env bash
# Runs the gate and records what the machine was doing while it ran.
#
# Two full runs of the e2e suite have failed on a Playwright timeout rather than
# an assertion, each on a different test. The obvious explanation is that this
# box ran out of capacity part way through, and the obvious explanation was not
# evidenced: the log recorded load and free memory ONCE, at the start, where the
# first failing run looked fine (load 2.81, 2.4Gi available). A number sampled
# before the eleven minutes that matter cannot support or refute a claim about
# what happened during them.
#
# So the sampler runs alongside the gate and the log carries the peak. A timeout
# is then attributable rather than argued about.
#
#   ./scripts/gate-evidence.sh [output-file] [-- ci-local args]
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-../.git/gate-evidence/$(git rev-parse --short HEAD)-frontend.log}"
shift || true
[ "${1:-}" = "--" ] && shift

SAMPLES=$(mktemp)
sample() {
  while :; do
    printf '%s %s %s\n' "$(date +%T)" "$(cut -d' ' -f1 /proc/loadavg)" \
      "$(awk '/MemAvailable/{printf "%.1f", $2/1048576}' /proc/meminfo)"
    sleep 10
  done
}
sample > "$SAMPLES" &
SAMPLER=$!
# `|| true` is load-bearing twice. The sampler is already reaped below, so this
# kill fails, and under `set -e` a failing command in an EXIT trap both aborts
# the trap before `rm` runs and replaces the script's exit status. The effect
# was that a green gate exited 1 and leaked its temp file, and every caller that
# piped this script read the pipe's status instead and never saw it.
trap 'kill "$SAMPLER" 2>/dev/null || true; rm -f "$SAMPLES"' EXIT INT TERM

{
  echo "sha      = $(git rev-parse HEAD)"
  echo "worktree = $(git status --porcelain | wc -l) modified paths"
  echo "started  = $(date -Is)"
  echo "node     = $(node --version)  pnpm = $(pnpm --version)"
  echo "cpus     = $(nproc)"
} > "$OUT"

set +e
./scripts/ci-local.sh "$@" >> "$OUT" 2>&1
GATE_EXIT=$?
set -e

kill "$SAMPLER" 2>/dev/null || true
{
  echo
  echo "CI_LOCAL_EXIT=$GATE_EXIT"
  echo "ended = $(date -Is)"
  echo
  echo "--- machine during the run, sampled every 10s ---"
  echo "samples          = $(wc -l < "$SAMPLES")"
  echo "load: min/max    = $(awk 'NR==1{m=$2;x=$2} {if($2<m)m=$2; if($2>x)x=$2} END{print m"/"x}' "$SAMPLES")"
  echo "memavail Gi: min = $(awk 'NR==1{m=$3} {if($3<m)m=$3} END{print m}' "$SAMPLES")"
  echo "worst minute     = $(sort -k2 -gr "$SAMPLES" | head -1)"
  echo
  echo "$(cat "$SAMPLES")"
} >> "$OUT"

exit "$GATE_EXIT"
