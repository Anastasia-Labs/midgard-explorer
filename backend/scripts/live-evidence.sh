#!/usr/bin/env bash
# Runs the opt-in live validation and captures its evidence in the same breath.
#
# `pnpm test` truncates the database the live suite writes to, so any ordinary
# suite run afterwards destroys the counts and the transactions that were the
# proof. Capturing here, immediately after the run, is what makes the evidence
# survive long enough to be recorded.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-../.git/gate-evidence/$(git rev-parse --short HEAD)-live.log}"
strip() { sed -e 's/^"//' -e 's/"$//'; }
env_val() { grep -oP "(?<=^$1=).*" .env | head -1 | strip; }

# The database is read out of TEST_INDEXER_POSTGRES_URL, the same variable the
# suite connects through, rather than assembled from discrete host/port/user
# variables that nothing constrains to agree with it. Assembling it separately
# meant the evidence header could name one database while the run wrote to
# another, which is the one thing a piece of evidence must not do.
TARGET_ENV="$(node - <<'NODE'
const dotenv = require("dotenv");
const { expand } = require("dotenv-expand");
expand(dotenv.config({ quiet: true }));
const raw = process.env.TEST_INDEXER_POSTGRES_URL;
if (!raw) {
  console.error("TEST_INDEXER_POSTGRES_URL is not set");
  process.exit(1);
}
const u = new URL(raw);
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
console.log("TARGET_HOST=" + q(u.hostname));
console.log("TARGET_PORT=" + q(u.port || "5432"));
console.log("TARGET_USER=" + q(decodeURIComponent(u.username)));
console.log("TARGET_DB=" + q(decodeURIComponent(u.pathname.replace(/^\//, ""))));
console.log("PGPASSWORD=" + q(decodeURIComponent(u.password)));
NODE
)" || { echo "could not resolve TEST_INDEXER_POSTGRES_URL"; exit 1; }
eval "$(printf '%s\n' "$TARGET_ENV" | grep -E '^(TARGET_HOST|TARGET_PORT|TARGET_USER|TARGET_DB|PGPASSWORD)=')"
export PGPASSWORD
TARGET="$TARGET_HOST:$TARGET_PORT/$TARGET_DB"
PSQL=(psql -h "$TARGET_HOST" -p "$TARGET_PORT" -U "$TARGET_USER" -d "$TARGET_DB" -X -A -F'|')

{
  echo "sha        = $(git rev-parse HEAD)"
  echo "started    = $(date -Is)"
  echo "koios      = $(env_val KOIOS_BASE_URL)"
  echo "manifest   = $(env_val MIDGARD_MANIFEST_PATH)"
  echo "index db   = $TARGET_USER@$TARGET"
} > "$OUT"

LIVE_E2E=1 pnpm vitest run test/live-validation.test.mts >> "$OUT" 2>&1
echo "live suite exit = $?" >> "$OUT"


{
  echo
  echo "=== counts ==="
  "${PSQL[@]}" -c "SELECT 'l1_tx',count(*) FROM l1_tx UNION ALL SELECT 'l1_event',count(*) FROM l1_event
                   UNION ALL SELECT 'l1_tx_io',count(*) FROM l1_tx_io
                   UNION ALL SELECT 'l1_redeemer',count(*) FROM l1_redeemer
                   UNION ALL SELECT 'l1_block_header',count(*) FROM l1_block_header;"
  echo "=== deployment attribution (must be exactly one row, never 'default') ==="
  "${PSQL[@]}" -c "SELECT deployment, count(*) FROM l1_event GROUP BY deployment;"
  echo "=== cursors (all three equal once a pass reconciles) ==="
  "${PSQL[@]}" -c "SELECT source, last_block_height FROM sync_cursor ORDER BY source;"
  echo "=== redeemer purposes ==="
  "${PSQL[@]}" -c "SELECT purpose, count(*) FROM l1_redeemer GROUP BY purpose ORDER BY purpose;"
  echo "=== representative SPEND ==="
  "${PSQL[@]}" -c "SELECT r.tx_hash, t.block_height, r.script_hash, r.purpose FROM l1_redeemer r
                   JOIN l1_tx t USING (tx_hash) WHERE r.purpose='spend'
                   ORDER BY t.block_height DESC LIMIT 1;"
  echo "=== representative MINT ==="
  "${PSQL[@]}" -c "SELECT r.tx_hash, t.block_height, r.script_hash, r.purpose FROM l1_redeemer r
                   JOIN l1_tx t USING (tx_hash) WHERE r.purpose='mint'
                   ORDER BY t.block_height DESC LIMIT 1;"
  echo "=== MINT reachable ONLY through the restored policy scan ==="
  "${PSQL[@]}" -c "SELECT DISTINCT a.tx_hash, t.block_height, a.policy_id, a.asset_name
                   FROM l1_tx_asset a JOIN l1_tx t USING (tx_hash)
                   WHERE a.policy_id IN ('008c416cdcfe3081a32202a605b777e3790947cdd00900cf72343958',
                                         '65976139558770f54efbe6a16cc2ae078007e347c2bff6e8e9f3a948')
                   ORDER BY t.block_height;"
  echo "=== WITHDRAW: reward-account discovery (not an execution) ==="
  "${PSQL[@]}" -c "SELECT tx_hash, block_height, epoch FROM l1_tx
                   WHERE tx_hash='75e2b7d9e2a1b8badd635a29b74e08975a72ef6574718e59eb1c538b6b60b7ef';"
  echo "=== WITHDRAW executions for this manifest's reward accounts, to max indexed height ==="
  "${PSQL[@]}" -c "SELECT (SELECT count(*) FROM l1_redeemer WHERE purpose='reward') AS reward_redeemers,
                          (SELECT max(block_height) FROM l1_tx) AS max_indexed_height;"
  echo
  echo "ended = $(date -Is)"
} >> "$OUT"

echo "evidence written to $OUT"
