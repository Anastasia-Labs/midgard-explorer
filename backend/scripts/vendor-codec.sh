#!/usr/bin/env bash
#
# Refresh the vendored @al-ft/midgard-core snapshot from a local codec checkout.
#
# WHY: the codec is not published to any registry, and the explorer is a separate
# repo (so the monorepo's `workspace:*` is unavailable). We vendor a packed tarball
# so installs are portable (CI / other machines / deploy) with no sibling-repo path
# assumption. INSTALL-TIME DOES NOT NEED THIS SCRIPT — the committed .tgz is
# self-contained (its deps @lucid-evolution/lucid, @noble/hashes, cborg are public).
# Only run this when you want to pull in newer codec changes.
#
# Usage:
#   ./scripts/vendor-codec.sh                 # uses ../../midgard/demo/midgard-core
#   MIDGARD_CORE_DIR=/path/to/midgard-core ./scripts/vendor-codec.sh
#
# After running, if this is the first time:  pnpm add file:vendor/al-ft-midgard-core.tgz
# On subsequent updates:                     pnpm install
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/vendor"
# Default assumes the midgard monorepo sits next to midgard-explorer; resolved from
# this script's location, so it works regardless of the current working directory.
CODEC_DIR="${MIDGARD_CORE_DIR:-$SCRIPT_DIR/../../../midgard/demo/midgard-core}"

if [ ! -f "$CODEC_DIR/package.json" ]; then
  echo "error: codec not found at '$CODEC_DIR' (set MIDGARD_CORE_DIR)" >&2
  exit 1
fi

echo "Building codec at $CODEC_DIR ..."
pnpm --dir "$CODEC_DIR" build

mkdir -p "$VENDOR_DIR"
# Stable filename so the package.json `file:` dep never changes across version bumps.
TARBALL="$(pnpm --dir "$CODEC_DIR" pack --pack-destination "$VENDOR_DIR" | tail -1)"
mv -f "$TARBALL" "$VENDOR_DIR/al-ft-midgard-core.tgz"

echo "Vendored -> backend/vendor/al-ft-midgard-core.tgz"
echo "Commit it:  git add backend/vendor/al-ft-midgard-core.tgz"
