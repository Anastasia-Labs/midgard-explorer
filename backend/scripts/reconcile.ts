/**
 * Reconciliation check between the midgard-node Postgres (the source of truth
 * the backend reads) and the explorer's own API.
 *
 * Verifies three things:
 *   1. Counts — each API total matches a direct table count.
 *   2. Enum audit — every status value present in the DB is one the explorer
 *      understands; a new upstream enum value fails the check instead of
 *      rendering as a blank or wrong state.
 *   3. Decode health — no committed transaction on the first list page carries
 *      a decodeError (codec drift shows up here first).
 *
 * Exit code 0 = reconciled; 1 = any mismatch, unknown enum, or decode failure.
 * Requires the backend API to be running (`pnpm dev`) against the same .env.
 */
import { prisma } from "../src/db";
import { config } from "../src/config";

const API = `http://127.0.0.1:${config.BACKEND_PORT}`;

type Row = { n: number };
type Distinct = { v: string | null };

let failed = false;
const report = (ok: boolean, label: string, detail: string) => {
  if (!ok) failed = true;
  console.log(`${ok ? "  ok " : "FAIL "} ${label.padEnd(34)} ${detail}`);
};

async function apiTotal(path: string): Promise<number> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const body = (await res.json()) as { total?: number | string };
  return Number(body.total);
}

async function main() {
  console.log(`reconcile: DB(${config.POSTGRES_PORT ?? "?"}) vs API(${API})\n`);

  // 1. Counts ---------------------------------------------------------------
  const [blocks, immutable, deposits, withdrawals, forced] = (
    await Promise.all([
      prisma.$queryRaw<Row[]>`SELECT COUNT(*)::int AS n FROM blocks`,
      prisma.$queryRaw<Row[]>`SELECT COUNT(*)::int AS n FROM immutable`,
      prisma.$queryRaw<Row[]>`SELECT COUNT(*)::int AS n FROM deposits_utxos`,
      prisma.$queryRaw<Row[]>`SELECT COUNT(*)::int AS n FROM withdrawal_utxos`,
      prisma.$queryRaw<Row[]>`SELECT COUNT(*)::int AS n FROM forced_transaction_utxos`,
    ])
  ).map((rows) => rows[0].n);

  const pairs: Array<[string, number, string]> = [
    ["blocks", blocks, "/api/blocks/total"],
    ["transactions (immutable)", immutable, "/api/transactions/total"],
    ["deposits", deposits, "/api/deposits/1"],
    ["withdrawals", withdrawals, "/api/withdrawals/1"],
    ["forced transactions", forced, "/api/forced-transactions/1"],
  ];
  for (const [label, dbCount, path] of pairs) {
    const api = await apiTotal(path);
    report(api === dbCount, `count: ${label}`, `db=${dbCount} api=${api}`);
  }

  // 2. Enum audit -----------------------------------------------------------
  const KNOWN: Array<[string, string, ReadonlySet<string>]> = [
    [
      "pending_block_finalizations",
      "status",
      new Set([
        "pending_submission",
        "submitted_local_finalization_pending",
        "submitted_unconfirmed",
        "observed_waiting_stability",
        "finalized",
        "abandoned",
      ]),
    ],
    ["deposits_utxos", "status", new Set(["awaiting", "projected", "consumed"])],
    ["withdrawal_utxos", "status", new Set(["awaiting", "projected", "finalized"])],
    [
      "forced_transaction_utxos",
      "status",
      new Set(["awaiting", "projected", "finalized"]),
    ],
    [
      "forced_transaction_utxos",
      "operator_validity",
      new Set([
        "TxIsValid",
        "NonExistentInputUtxo",
        "InvalidSignature",
        "FailedScript",
        "FeeTooLow",
        "UnbalancedTx",
      ]),
    ],
    // The explorer's lifecycle fallback maps exactly these admission states;
    // anything else in the table is a lifecycle the UI cannot express and
    // must be flagged.
    ["tx_admissions", "status", new Set(["queued", "validating", "accepted"])],
  ];
  for (const [table, column, known] of KNOWN) {
    const rows = await prisma.$queryRawUnsafe<Distinct[]>(
      `SELECT DISTINCT ${column}::text AS v FROM ${table}`,
    );
    const unknown = rows
      .map((r) => r.v)
      .filter((v): v is string => v !== null && !known.has(v));
    report(
      unknown.length === 0,
      `enum: ${table}.${column}`,
      unknown.length === 0
        ? `${rows.length} distinct, all known`
        : `unknown values: ${unknown.join(", ")}`,
    );
  }

  // 3. Decode health --------------------------------------------------------
  const txPage = await fetch(`${API}/api/transactions/1`);
  const txBody = (await txPage.json()) as {
    rows?: Array<{ decodeError: string | null }>;
  };
  const decodeFailures = (txBody.rows ?? []).filter(
    (r) => r.decodeError !== null,
  ).length;
  report(
    decodeFailures === 0,
    "decode: transactions page 1",
    `${txBody.rows?.length ?? 0} rows, ${decodeFailures} decode failures`,
  );

  // Informational context (not pass/fail).
  const [mempool, rejections] = (
    await Promise.all([
      prisma.$queryRaw<Row[]>`SELECT COUNT(*)::int AS n FROM mempool`,
      prisma.$queryRaw<Row[]>`SELECT COUNT(*)::int AS n FROM tx_rejections`,
    ])
  ).map((rows) => rows[0].n);
  console.log(`\ninfo: mempool=${mempool} tx_rejections=${rejections}`);

  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: reconciled");
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("reconcile error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
