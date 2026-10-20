#!/usr/bin/env bash
#
# Build and pack the Midgard package graph at one commit and deployment profile.
#
# The packages are not published, and their compiled constants (consensus
# profile, deployment profile) decide which deployments they accept, so the
# explorer vendors tarballs built from a named commit for a named profile.
#
# Usage: scripts/vendor-midgard.sh <full-commit> <profile> [midgard-repo]
#   midgard-repo defaults to ../../midgard beside this repository. The script
#   reads it with `git archive` only; it never changes that checkout.
#
# Writes backend/vendor/midgard/*.tgz and backend/vendor/midgard/manifest.json.
# Midgard builds under Node 22.22.2, so nvm must have that version installed.
set -euo pipefail

REV=${1:?full commit hash}
PROFILE=${2:?deployment profile}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BACKEND=$(cd "$SCRIPT_DIR/.." && pwd)
MIDGARD=${3:-$BACKEND/../../midgard}
OUT=${VENDOR_OUT:-$BACKEND/vendor/midgard}

[[ $REV =~ ^[0-9a-f]{40}$ ]] || { echo "error: give the full 40-hex commit, got '$REV'" >&2; exit 2; }
git -C "$MIDGARD" cat-file -e "$REV^{commit}"

PACKAGES=(
  l1-node-transport midgard-core midgard-sdk midgard-validation
  midgard-fault-proofs lucid-midgard midgard-l1-follower midgard-watcher
)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git -C "$MIDGARD" archive "$REV" | tar -x -C "$WORK"
cd "$WORK/demo"

# shellcheck disable=SC1090
source "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null
nvm use 22.22.2 >/dev/null
echo "node $(node -v), pnpm $(pnpm -v)"

pnpm install --frozen-lockfile >"$WORK/install.log" 2>&1 || { tail -30 "$WORK/install.log"; exit 1; }
# Fails unless the committed generated profile module is this profile's.
node scripts/deployment-profiles.mjs check "$PROFILE"

FILTERS=()
for p in "${PACKAGES[@]}"; do FILTERS+=(--filter "./$p"); done
pnpm "${FILTERS[@]}" run build >"$WORK/build.log" 2>&1 || { tail -40 "$WORK/build.log"; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT"
for p in "${PACKAGES[@]}"; do
  # Midgard's local build receipt: the absolute build directory and a random
  # run id. No packaged code reads it, and it is the only per-run file, so the
  # tarballs are byte-identical across builds without it.
  rm -f "$p/dist/.contrib-build-v1.json"
  (cd "$p" && pnpm pack --pack-destination "$OUT" >/dev/null)
done
cp vendor/mpf-1.3.1-midgard.1.tgz "$OUT/"
mkdir -p "$OUT/patches"
cp "patches/@lucid-evolution__utils@0.2.0.patch" "$OUT/patches/"

node - "$OUT" "$REV" "$PROFILE" <<'EOF'
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const [out, commit, profile] = process.argv.slice(2);
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const files = readdirSync(out).filter((f) => f.endsWith(".tgz")).sort();
const patches = readdirSync(join(out, "patches")).sort();
const manifest = {
  commit,
  profile,
  tarballs: Object.fromEntries(files.map((f) => [f, sha(join(out, f))])),
  patches: Object.fromEntries(patches.map((f) => [f, sha(join(out, "patches", f))])),
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
EOF
