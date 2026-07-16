# Explorer Resync with Midgard tx-validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-align the explorer with the current Midgard `tx-validation` branch (node commit `0d74cc47`) — fix the two queries broken by the `latest_ledger` table removal, then surface the new L2 information (tx lifecycle status, DA payload metadata, block finalization, deposits, withdrawals, forced transactions).

**Architecture:** The explorer backend (Express 5 + Prisma 7 driver-adapter) keeps reading the node's Postgres directly with raw SQL, exactly as it does today. The vendored codec tarball `@al-ft/midgard-core@0.1.0` stays as-is — the tx wire format (`cddl-files/codec.cddl`) and the decode API are unchanged upstream; only internal refactors and a new `da-transport` module landed, and nothing in this plan needs `da-transport` (DA metadata is stored as plain columns in `da_payloads`). New surfaces are read-only table scans mapped to JSON, rendered by new sections/pages in the existing React frontend.

**Tech Stack:** TypeScript, Express 5, Prisma 7 (`$queryRaw`), React + react-router + axios, Tailwind. Node/pnpm versions: use whatever `backend/package.json` / `frontend/package.json` pin — run `nvm use` first.

## What changed upstream (investigation summary, verified 2026-07-14)

| Upstream change (commit) | Explorer impact |
|---|---|
| `latest_ledger` and `deposit_ingestion_cursor` tables **removed** (`0e708059`, 2026-07-07) | **BREAKS** `backend/src/db/address.ts:13` (address balance) and `backend/src/db/ledger.ts:25` (input resolution). Both raw queries now throw `relation "latest_ledger" does not exist`. |
| Live ledger is now `mempool_ledger` alone; the node's spendable set = rows where `source_event_id IS NULL OR deposits_utxos.projected_header_hash IS NOT NULL` | Replicate that predicate for address balance; drop the `latest_ledger` branch from `findOutRef`. |
| `da_payloads` is now **v2** (`0007_da_payloads_v2.sql`): 7 roots (`utxos`, `transactions`, `deposits`, `withdrawals`, `forced_transactions`, `transition_trace`, `event_to_step`) + 6 counts + block start/end times | New block-page section. Read columns directly — no CBOR decode needed. |
| `pending_block_finalizations` has a 6-value `status` enum (`pending_submission` … `finalized`, `abandoned`) + `submitted_tx_hash` | New block-page finalization status. |
| `tx_rejections` (code/detail/created_at) and `tx_admissions` (`queued`/`validating`/`accepted`/`rejected`) hold the tx lifecycle; node's canonical priority is in `demo/midgard-node/src/commands/tx-status.ts` (`resolveTxStatus`) | Tx page can show `committed` / `pending_commit` / `accepted` / `rejected` / `validating` / `queued` instead of just a pending flag. |
| `deposits_utxos`, `withdrawal_utxos`, `forced_transaction_utxos` are populated event tables with status enums | Three new list surfaces. |
| Codec `demo/midgard-core`: still version 0.1.0; decode API + CDDL unchanged; new `da-transport` + `plutus-data-cbor` modules added | **No tarball re-vendor needed.** Re-vendor only if we later decode DA payload bodies. |
| Node HTTP API: no DA endpoints; `/tx-status` (GET+batch POST), `/pipeline-status`, `/deposit-status` exist | Stay Postgres-direct (consistent with the whole backend); we replicate `resolveTxStatus` from tables we already read + 2 new ones. |
| Tables the explorer already reads (`blocks`, `immutable`, `mempool`, `processed_mempool`, `address_history`, `confirmed_ledger`, `mempool_ledger`) | **Unchanged.** Tx decode path keeps working. |

## Global Constraints

- Package manager: **pnpm** (never npm/npx). Backend commands run from `backend/`, frontend from `frontend/`.
- Backend verification command: `pnpm typecheck` (`tsc --noEmit`). Frontend: `pnpm build` (`tsc -b && vite build`).
- **Declared deviation from TDD:** this repo has no test runner (adding one is roadmap Phase 4, out of scope here). Every task's test cycle is replaced by: typecheck/build + a live smoke check against a running node DB where stated. This is a deliberate, declared subset.
- Additive only — do not remove working routes, fields, or the `pending` response flag (keep backward compatibility for the frontend while it migrates).
- Follow existing code style: raw `$queryRaw` in `backend/src/db/*.ts`, thin Express handlers in `backend/src/server/routes/*.ts`, `toHex` for byte columns, axios client `frontend/src/api/client.ts`.
- `BIGINT` columns from `$queryRaw` arrive as JS `bigint`. The backend has a global BigInt→string JSON middleware (`backend/src/server/server.ts:29`), so responses won't crash — but counts must still be converted with `Number(...)` in the DB layer so the API contract types them as numbers, not strings.
- Node dev DB runs on host port **5433**; the node repo is `/home/harun/dev/cardano/AnastasiaLabs/midgard` (`demo/midgard-node`).
- Commit after every task. Commit messages: plain conventional commits, state what changed, no defensive phrasing.

---

### Task 1: Restore address UTxOs query (`latest_ledger` → spendable `mempool_ledger`)

**Files:**
- Modify: `backend/src/db/address.ts:7-14`

**Interfaces:**
- Produces: `getAddressUtxos(address: string): Promise<Array<{ output: Uint8Array }>>` — same signature as today; only the SQL changes. `backend/src/server/routes/address.ts:13` keeps working unmodified.

- [ ] **Step 1: Replace the query**

Replace `getAddressUtxos` (and its doc comment) in `backend/src/db/address.ts` with:

```ts
/**
 * Current spendable UTxOs owned by an address. The node's live ledger is
 * `mempool_ledger`; deposit-sourced rows only become spendable once their
 * deposit is projected (mirrors the node's `spendablePredicate` in
 * demo/midgard-node/src/database/mempoolLedger.ts). Each `output` is
 * Midgard-native canonical CBOR; the decode layer turns it into a value.
 */
export async function getAddressUtxos(address: string) {
  return prisma.$queryRaw<Array<{ output: Uint8Array }>>`
    SELECT ml.output
    FROM mempool_ledger AS ml
    LEFT JOIN deposits_utxos AS d ON d.event_id = ml.source_event_id
    WHERE ml.address = ${address}
      AND (ml.source_event_id IS NULL OR d.projected_header_hash IS NOT NULL);`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && pnpm typecheck`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/address.ts
git commit -m "fix(backend): read address utxos from mempool_ledger spendable set"
```

---

### Task 2: Restore input resolution (`findOutRef` without `latest_ledger`)

**Files:**
- Modify: `backend/src/db/ledger.ts:15-32`

**Interfaces:**
- Produces: `findOutRef(outref: Uint8Array): Promise<LedgerOutput | null>` — same signature; `backend/src/server/routes/transaction.ts:28` keeps working unmodified.

- [ ] **Step 1: Drop the latest_ledger branch**

Replace the query inside `findOutRef` in `backend/src/db/ledger.ts` with:

```ts
  // ORDER BY priority enforces mempool→confirmed deterministically; a bare
  // UNION ALL + LIMIT 1 leaves the branch order to the planner.
  const rows = await prisma.$queryRaw<LedgerOutput[]>`
    SELECT address, output FROM (
      SELECT address, output, 0 AS priority FROM mempool_ledger WHERE outref = ${key}
      UNION ALL
      SELECT address, output, 1 AS priority FROM confirmed_ledger WHERE outref = ${key}
    ) AS candidates
    ORDER BY priority
    LIMIT 1;`;
```

Also update the function's doc comment: the scan order is now "mempool ledger first, then confirmed ledger" (delete the word "latest").

- [ ] **Step 2: Typecheck**

Run: `cd backend && pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/ledger.ts
git commit -m "fix(backend): drop removed latest_ledger from outref resolution"
```

---

### Task 3: Prisma schema realign

**Files:**
- Modify: `backend/prisma/schema.prisma` (remove the `LatestLedger` model at ~lines 25-38; add `source_event_id Bytes?` to `MempoolLedger`; update the stale "Staging" TODO comment at the top to say the schema mirrors the node's `tx-validation` migrations)

**Interfaces:**
- Consumes: nothing new. No code references `prisma.latestLedger` (verified — only raw SQL used it), so removing the model breaks nothing.
- Produces: regenerated Prisma client in `backend/prisma/explorer-client`.

- [ ] **Step 1: Edit schema.prisma**

Delete the whole `model LatestLedger { ... }` block (it maps `@@map("latest_ledger")`). In `model MempoolLedger`, add after `address String`:

```prisma
  source_event_id Bytes?
```

- [ ] **Step 2: Regenerate + typecheck**

Run: `cd backend && pnpm prisma:generate && pnpm typecheck`
Expected: "Generated Prisma Client" then clean typecheck.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma
git commit -m "chore(backend): realign prisma schema with tx-validation migrations"
```

---

### Task 4: Node environment reset + live verification of Tasks 1–3

This is operational, not code. The June-era dev DB volume cannot be reused: migration files were renumbered and `da_payloads` v2 refuses in-place migration by design.

- [ ] **Step 1: Reset and start the node**

```bash
cd /home/harun/dev/cardano/AnastasiaLabs/midgard/demo/midgard-node
docker compose down -v          # discard the stale volume
docker compose up -d            # postgres on host port 5433
# start the node per its README (.env has RUN_GENESIS_ON_STARTUP=true, so
# migrations + genesis run inside `listen` startup — no separate init step)
```

- [ ] **Step 2: Generate activity**

Submit at least one L2 transfer from the node repo (`submit-l2-transfer` command or `pnpm stress:nominal`; funded seeds are in the node `.env`).

- [ ] **Step 3: Smoke-check the explorer backend**

```bash
cd backend && pnpm dev   # in one terminal
# then:
curl -s "http://localhost:3101/api/address/<funded bech32 address>" | head -c 400
curl -s "http://localhost:3101/api/transaction?tx_hash=<submitted tx hash>" | head -c 400
```

Expected: address responds with a JSON balance (no 500 / relation error); transaction responds with decoded JSON and, for a mempool tx, `input.resolved` entries — this finally closes the long-pending byte-for-byte outref-key live verification. If input resolution returns null for all inputs, stop and debug before continuing (systematic-debugging skill).

- [ ] **Step 4: Note verification result in the commit trailer of the next task** (no separate commit).

---

### Task 5: Full tx lifecycle status on the transaction page

Replicates the node's `resolveTxStatus` priority (see `demo/midgard-node/src/commands/tx-status.ts:66-137`): `committed` (immutable) → `pending_commit` (processed_mempool) → `accepted` (mempool) → `rejected` (tx_rejections) → `validating`/`queued` (tx_admissions) → 404. We skip `awaiting_local_recovery` (needs node-process globals we can't see; `pending_commit` is the honest Postgres-visible answer).

**Files:**
- Modify: `backend/src/db/transaction.ts` (extend `getTransaction`, add `getTxLifecycle`)
- Modify: `backend/src/server/routes/transaction.ts:13-42` (`getTransactionRoute`)
- Modify: `frontend/src/cddl.ts` (add `TxStatus` type), `frontend/src/api/transaction.ts` (response type), `frontend/src/pages/Transaction.tsx:97-100` (badge)

**Interfaces:**
- Produces (backend): `getTransaction(txHash)` now returns `{ tx, time_stamp_tz, pending, source: "mempool" | "processed_mempool" | "immutable" } | null`; `getTxLifecycle(txHash): Promise<{ status: "rejected"; reasonCode: string; reasonDetail: string | null; rejectedAt: Date } | { status: "queued" | "validating" } | null>`.
- Produces (API contract): tx response gains `status: TxStatus` and optional `rejection: { reasonCode: string; reasonDetail: string | null; rejectedAt: string }`; `pending` is kept.
- `type TxStatus = "committed" | "pending_commit" | "accepted" | "rejected" | "validating" | "queued"`.

- [ ] **Step 1: Extend `getTransaction` in `backend/src/db/transaction.ts`**

Current shape (lines 20-33): checks `mempoolTx` then `immutableTx` and returns `pending`. Replace with a three-tier check; keep `pending` derived:

```ts
export async function getTransaction(txHash: string) {
  const key = Buffer.from(txHash, "hex");
  const mempoolRow = await prisma.mempoolTx.findUnique({
    where: { tx_id: key },
  });
  if (mempoolRow) {
    return { ...mempoolRow, pending: true, source: "mempool" as const };
  }
  const processedRow = await prisma.processedMempoolTx.findUnique({
    where: { tx_id: key },
  });
  if (processedRow) {
    return {
      ...processedRow,
      pending: true,
      source: "processed_mempool" as const,
    };
  }
  const immutableRow = await prisma.immutableTx.findUnique({
    where: { tx_id: key },
  });
  if (immutableRow) {
    return { ...immutableRow, pending: false, source: "immutable" as const };
  }
  return null;
}
```

(Adjust the exact `findUnique` shape to match the current file — keep whatever select/where form is already there; only the processed_mempool tier and `source` field are new. If `ProcessedMempoolTx` rows lack `time_stamp_tz`, check the model in `schema.prisma` and fall back to `null` for timestamp.)

- [ ] **Step 2: Add `getTxLifecycle` in the same file**

```ts
export type TxLifecycle =
  | {
      status: "rejected";
      reasonCode: string;
      reasonDetail: string | null;
      rejectedAt: Date;
    }
  | { status: "queued" | "validating" }
  | null;

/** Lifecycle for txs not present in any tx table: rejected, or still in admission. */
export async function getTxLifecycle(txHash: string): Promise<TxLifecycle> {
  const key = Buffer.from(txHash, "hex");
  const rejections = await prisma.$queryRaw<
    Array<{ reject_code: string; reject_detail: string | null; created_at: Date }>
  >`SELECT reject_code, reject_detail, created_at FROM tx_rejections
    WHERE tx_id = ${key} ORDER BY created_at DESC LIMIT 1;`;
  if (rejections.length > 0) {
    return {
      status: "rejected",
      reasonCode: rejections[0].reject_code,
      reasonDetail: rejections[0].reject_detail,
      rejectedAt: rejections[0].created_at,
    };
  }
  const admissions = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM tx_admissions WHERE tx_id = ${key};`;
  const admissionStatus = admissions[0]?.status;
  if (admissionStatus === "queued" || admissionStatus === "validating") {
    return { status: admissionStatus };
  }
  return null;
}
```

- [ ] **Step 3: Wire into `getTransactionRoute` in `backend/src/server/routes/transaction.ts`**

Replace the `if (!tx) return 404` block and the success response:

```ts
  const tx = await getTransaction(txHash);
  if (!tx) {
    const lifecycle = await getTxLifecycle(txHash);
    if (lifecycle?.status === "rejected") {
      return res.json({
        transaction: null,
        status: "rejected",
        rejection: {
          reasonCode: lifecycle.reasonCode,
          reasonDetail: lifecycle.reasonDetail,
          rejectedAt: lifecycle.rejectedAt,
        },
      });
    }
    if (lifecycle) {
      return res.json({ transaction: null, status: lifecycle.status });
    }
    return res.status(404).json({ error: "Transaction not found." });
  }

  const status =
    tx.source === "immutable"
      ? "committed"
      : tx.source === "processed_mempool"
        ? "pending_commit"
        : "accepted";

  try {
    const transaction = await decodeTransaction(tx.tx, findOutRef);
    return res.json({
      transaction: {
        ...transaction,
        timestamp: tx.time_stamp_tz,
        pending: tx.pending,
      },
      status,
    });
  } catch (err) { /* unchanged 422 handler */ }
```

Import `getTxLifecycle` alongside the existing imports.

- [ ] **Step 4: Frontend contract + badge**

In `frontend/src/cddl.ts` add:

```ts
export type TxStatus =
  | "committed"
  | "pending_commit"
  | "accepted"
  | "rejected"
  | "validating"
  | "queued";
```

In `frontend/src/api/transaction.ts`, extend the tx-detail response type with `status?: TxStatus` and `rejection?: { reasonCode: string; reasonDetail: string | null; rejectedAt: string }`, and stop treating `transaction: null` as an error when `status` is present.

In `frontend/src/pages/Transaction.tsx`, replace the pending ternary (lines 97-100) with a status badge driven by this map (copy the existing badge's className pattern; amber for in-flight, green for committed, red for rejected):

```tsx
const STATUS_LABELS: Record<TxStatus, string> = {
  committed: "Committed",
  pending_commit: "Pending commit",
  accepted: "Accepted (mempool)",
  rejected: "Rejected",
  validating: "Validating",
  queued: "Queued",
};
```

For `status === "rejected"` render a small panel with `rejection.reasonCode` and `rejection.reasonDetail` instead of the tx body. Fall back to the old `pending` flag when `status` is absent (older backend).

- [ ] **Step 5: Verify**

Run: `cd backend && pnpm typecheck && cd ../frontend && pnpm build`
Expected: both clean.
Live: `curl -s "http://localhost:3101/api/transaction?tx_hash=<known tx>"` shows `"status":"committed"` (or `accepted`); a garbage-but-valid-hex hash returns 404; if you can submit an intentionally invalid tx, its hash returns `"status":"rejected"` with a reason code.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/transaction.ts backend/src/server/routes/transaction.ts frontend/src/cddl.ts frontend/src/api/transaction.ts frontend/src/pages/Transaction.tsx
git commit -m "feat: full tx lifecycle status (committed/pending_commit/accepted/rejected/validating/queued)"
```

---

### Task 6: Block page — DA payload metadata + finalization status

**Files:**
- Modify: `backend/src/db/block.ts` (add `getBlockDaMetadata`, `getBlockFinalization`)
- Modify: `backend/src/server/routes/block.ts:12-42` (`getBlockRoute`)
- Modify: `frontend/src/api/block.ts` (types), `frontend/src/pages/Block.tsx` (two new sections)

**Interfaces:**
- Produces (backend): `getBlockDaMetadata(headerHash: string)` → `{ utxos_root, transactions_root, deposits_root, withdrawals_root, forced_transactions_root, transition_trace_root, event_to_step_root: string; l2_transaction_count, deposit_count, withdrawal_count, forced_transaction_count, total_event_count, transition_step_count: number; block_start_time, block_end_time: Date } | null`; `getBlockFinalization(headerHash: string)` → `{ status: string; submitted_tx_hash: string | null } | null`.
- Produces (API contract): block response gains top-level `da` and `finalization` (both nullable).

- [ ] **Step 1: Add the two readers to `backend/src/db/block.ts`**

```ts
export async function getBlockDaMetadata(headerHash: string) {
  const key = Buffer.from(headerHash, "hex");
  const rows = await prisma.$queryRaw<
    Array<{
      utxos_root: string;
      transactions_root: string;
      deposits_root: string;
      withdrawals_root: string;
      forced_transactions_root: string;
      transition_trace_root: string;
      event_to_step_root: string;
      l2_transaction_count: bigint;
      deposit_count: bigint;
      withdrawal_count: bigint;
      forced_transaction_count: bigint;
      total_event_count: bigint;
      transition_step_count: bigint;
      block_start_time: Date;
      block_end_time: Date;
    }>
  >`SELECT utxos_root, transactions_root, deposits_root, withdrawals_root,
       forced_transactions_root, transition_trace_root, event_to_step_root,
       l2_transaction_count, deposit_count, withdrawal_count,
       forced_transaction_count, total_event_count, transition_step_count,
       block_start_time, block_end_time
     FROM da_payloads WHERE header_hash = ${key};`;
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    l2_transaction_count: Number(row.l2_transaction_count),
    deposit_count: Number(row.deposit_count),
    withdrawal_count: Number(row.withdrawal_count),
    forced_transaction_count: Number(row.forced_transaction_count),
    total_event_count: Number(row.total_event_count),
    transition_step_count: Number(row.transition_step_count),
  };
}

export async function getBlockFinalization(headerHash: string) {
  const key = Buffer.from(headerHash, "hex");
  const rows = await prisma.$queryRaw<
    Array<{ status: string; submitted_tx_hash: Uint8Array | null }>
  >`SELECT status, submitted_tx_hash FROM pending_block_finalizations
    WHERE header_hash = ${key};`;
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    submitted_tx_hash: row.submitted_tx_hash
      ? Buffer.from(row.submitted_tx_hash).toString("hex")
      : null,
  };
}
```

- [ ] **Step 2: Wire into `getBlockRoute`**

After the existing `rows` mapping in `backend/src/server/routes/block.ts`, fetch both in parallel and add to the response:

```ts
  const [da, finalization] = await Promise.all([
    getBlockDaMetadata(headerHash),
    getBlockFinalization(headerHash),
  ]);
  return res.json({ rows: payload, da, finalization });
```

- [ ] **Step 3: Frontend**

Extend the block response type in `frontend/src/api/block.ts` with `da` and `finalization` (mirror the backend shapes; timestamps as strings). In `frontend/src/pages/Block.tsx` add, below the existing block header section:

- a "Finalization" line: badge with `finalization.status` (map the 6 enum values to labels: `pending_submission` → "Pending submission", `submitted_local_finalization_pending` → "Submitted (local finalization pending)", `submitted_unconfirmed` → "Submitted (unconfirmed)", `observed_waiting_stability` → "Awaiting L1 stability", `finalized` → "Finalized", `abandoned` → "Abandoned"); show `submitted_tx_hash` as a monospace hex string when present. When `finalization` is null and `da` exists, show "Merged" (rows are cleaned up after merge); when both are null, omit the section.
- a "Data availability" card: a 2-column definition list of the 7 roots (monospace, truncated with full value in `title`) and a count row: `L2 txs · deposits · withdrawals · forced txs · total events · trace steps`, plus `block_start_time`/`block_end_time` formatted like existing timestamps.

Copy the card/section styling already used in `Block.tsx` — no new design system.

- [ ] **Step 4: Verify**

Run: `cd backend && pnpm typecheck && cd ../frontend && pnpm build` → clean.
Live: open a block page for a block that has merged; the DA section shows 7 roots and counts consistent with the block's tx list length.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/block.ts backend/src/server/routes/block.ts frontend/src/api/block.ts frontend/src/pages/Block.tsx
git commit -m "feat: show DA payload metadata and finalization status on block page"
```

---

### Task 7: Deposits surface (L1 → L2)

**Files:**
- Create: `backend/src/db/deposits.ts`
- Modify: `backend/src/server/routes.ts` (register route), create handler in `backend/src/server/routes/deposits.ts`
- Create: `frontend/src/api/deposits.ts`, `frontend/src/pages/Deposits.tsx`
- Modify: `frontend/src/App.tsx` (route `/deposits/:page`), nav component (add "Deposits" link — the nav lives in `frontend/src/App.tsx` or the shared layout; follow where "Transactions" is linked)

**Interfaces:**
- Consumes: `computeBalance(outputs: Uint8Array[])` from `backend/src/decode/transaction.ts:142` (existing; decodes native output CBOR to a value view).
- Produces: `GET /api/deposits/:page` → `{ rows: DepositRow[]; hasNextPage: boolean; total: number; limit: number }` where `DepositRow = { event_id: string; deposit_l1_tx_hash: string; ledger_tx_id: string; ledger_address: string; status: "awaiting" | "projected" | "consumed"; inclusion_time: string; projected_header_hash: string | null; value: /* computeBalance view */ }`.

- [ ] **Step 1: DB reader `backend/src/db/deposits.ts`**

```ts
import { prisma } from "../db";

const LIMIT = 25;

export async function getDepositsPage(page: number) {
  const offset = (page - 1) * LIMIT;
  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        event_id: Uint8Array;
        deposit_l1_tx_hash: Uint8Array;
        ledger_tx_id: Uint8Array;
        ledger_address: string;
        ledger_output: Uint8Array;
        status: string;
        inclusion_time: Date;
        projected_header_hash: Uint8Array | null;
      }>
    >`SELECT event_id, deposit_l1_tx_hash, ledger_tx_id, ledger_address,
         ledger_output, status, inclusion_time, projected_header_hash
       FROM deposits_utxos
       ORDER BY inclusion_time DESC, event_id DESC
       LIMIT ${LIMIT + 1} OFFSET ${offset};`,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM deposits_utxos;`,
  ]);
  return {
    rows: rows.slice(0, LIMIT),
    hasNextPage: rows.length > LIMIT,
    total: Number(totalRows[0].count),
    limit: LIMIT,
  };
}
```

- [ ] **Step 2: Route handler `backend/src/server/routes/deposits.ts`**

```ts
import { Request, Response } from "express";
import { getDepositsPage } from "../../db/deposits";
import { computeBalance } from "../../decode/transaction";
import { toHex } from "../../utils";

export async function getDepositsPageRoute(req: Request, res: Response) {
  const page = Number(req.params.page);
  if (!Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: "Invalid page." });
  }
  const { rows, hasNextPage, total, limit } = await getDepositsPage(page);
  const payload = await Promise.all(
    rows.map(async (row) => ({
      event_id: toHex(row.event_id),
      deposit_l1_tx_hash: toHex(row.deposit_l1_tx_hash),
      ledger_tx_id: toHex(row.ledger_tx_id),
      ledger_address: row.ledger_address,
      status: row.status,
      inclusion_time: row.inclusion_time,
      projected_header_hash: row.projected_header_hash
        ? toHex(row.projected_header_hash)
        : null,
      value: await computeBalance([row.ledger_output]),
    })),
  );
  return res.json({ rows: payload, hasNextPage, total, limit });
}
```

Register in `backend/src/server/routes.ts` next to the existing paginated routes: `app.get("/api/deposits/:page", getDepositsPageRoute);` (match the exact registration style used there).

- [ ] **Step 3: Frontend page**

`frontend/src/api/deposits.ts`: axios call to `/api/deposits/:page` typed to the contract above. `frontend/src/pages/Deposits.tsx`: clone the structure of `frontend/src/pages/Transactions.tsx` (same pagination component and table styling) with columns: status badge (`awaiting` amber / `projected` blue / `consumed` green), L1 tx hash (mono, truncated), L2 address (link to `/address/:address`), value (lovelace, formatted like existing value rendering), inclusion time (existing timestamp formatting), projected block (link to `/block/:hash` when present). Add the route in `frontend/src/App.tsx` and a "Deposits" nav link.

- [ ] **Step 4: Verify**

`cd backend && pnpm typecheck && cd ../frontend && pnpm build` → clean.
Live: perform a deposit on the dev node (or check an existing one): `curl -s http://localhost:3101/api/deposits/1` returns rows; page renders.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/deposits.ts backend/src/server/routes/deposits.ts backend/src/server/routes.ts frontend/src/api/deposits.ts frontend/src/pages/Deposits.tsx frontend/src/App.tsx
git commit -m "feat: deposits page (L1->L2) from deposits_utxos"
```

---

### Task 8: Withdrawals surface (L2 → L1)

**Files:**
- Modify: `backend/src/decode/transaction.ts` (add `decodeValueSafe`)
- Create: `backend/src/db/withdrawals.ts`, `backend/src/server/routes/withdrawals.ts`
- Modify: `backend/src/server/routes.ts`
- Create: `frontend/src/api/withdrawals.ts`, `frontend/src/pages/Withdrawals.tsx`
- Modify: `frontend/src/App.tsx` (+nav link)

**Interfaces:**
- Consumes: the codec loader in `backend/src/decode/codec.ts` (cached dynamic `import()` of `@al-ft/midgard-core`) and the value→view mapper that `computeBalance` already uses inside `backend/src/decode/transaction.ts`.
- Produces: `decodeValueSafe(valueCbor: Uint8Array): Promise<ValueView | null>` (backend); `GET /api/withdrawals/:page` → same page envelope as deposits with `WithdrawalRow = { event_id: string; withdrawal_l1_tx_hash: string; withdrawal_l1_output_index: number; l2_outref: string; l2_value: ValueView | null; l1_address: string /* hex */; validity: string | null; status: "awaiting" | "projected" | "finalized"; inclusion_time: string; projected_header_hash: string | null }`.

- [ ] **Step 1: Add `decodeValueSafe` to `backend/src/decode/transaction.ts`**

Next to `computeBalance` (line 142), add a helper that decodes a bare native value (not an output). It reuses the file's existing `toValueView` mapper (line 37) and the cached codec loader `getCodec` from `backend/src/decode/codec.ts`; `decodeMidgardValue` is exported by the vendored tarball (verified in `backend/node_modules/@al-ft/midgard-core/dist/codec/value.d.ts`):

```ts
/** Decode a bare Midgard-native value CBOR (e.g. withdrawal_utxos.l2_value). */
export async function decodeValueSafe(
  valueCbor: Uint8Array,
): Promise<ValueView | null> {
  try {
    const codec = await getCodec();
    return toValueView(codec.decodeMidgardValue(Buffer.from(valueCbor)));
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: DB reader `backend/src/db/withdrawals.ts`**

Same pattern as deposits (LIMIT 25, `+1` row for `hasNextPage`, COUNT in parallel):

```ts
import { prisma } from "../db";

const LIMIT = 25;

export async function getWithdrawalsPage(page: number) {
  const offset = (page - 1) * LIMIT;
  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        event_id: Uint8Array;
        withdrawal_l1_tx_hash: Uint8Array;
        withdrawal_l1_output_index: number;
        l2_outref: Uint8Array;
        l2_value: Uint8Array;
        l1_address: Uint8Array;
        validity: string | null;
        status: string;
        inclusion_time: Date;
        projected_header_hash: Uint8Array | null;
      }>
    >`SELECT event_id, withdrawal_l1_tx_hash, withdrawal_l1_output_index,
         l2_outref, l2_value, l1_address, validity, status, inclusion_time,
         projected_header_hash
       FROM withdrawal_utxos
       ORDER BY inclusion_time DESC, event_id DESC
       LIMIT ${LIMIT + 1} OFFSET ${offset};`,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM withdrawal_utxos;`,
  ]);
  return {
    rows: rows.slice(0, LIMIT),
    hasNextPage: rows.length > LIMIT,
    total: Number(totalRows[0].count),
    limit: LIMIT,
  };
}
```

- [ ] **Step 3: Route handler + registration**

`backend/src/server/routes/withdrawals.ts` — mirror the deposits handler: hex-encode byte columns with `toHex`, decode `l2_value` with `decodeValueSafe`, pass `l1_address` through as hex (it is a standard L1 Cardano address; bech32 rendering can come later — label the column "L1 address (hex)"). Register `app.get("/api/withdrawals/:page", ...)` in `backend/src/server/routes.ts`.

- [ ] **Step 4: Frontend page**

Clone the Deposits page structure: columns status (`awaiting` amber / `projected` blue / `finalized` green), validity badge (`WithdrawalIsValid` green, any other non-null value red with the code as the label, null → "—"), L1 tx `hash#index`, L2 value (lovelace), inclusion time, projected block link. Route `/withdrawals/:page` + nav link.

- [ ] **Step 5: Verify + commit**

`pnpm typecheck` (backend) + `pnpm build` (frontend) clean; `curl -s http://localhost:3101/api/withdrawals/1` returns `{ rows: [...] }` (empty rows array is fine if no withdrawals were made).

```bash
git add backend/src/decode/transaction.ts backend/src/db/withdrawals.ts backend/src/server/routes/withdrawals.ts backend/src/server/routes.ts frontend/src/api/withdrawals.ts frontend/src/pages/Withdrawals.tsx frontend/src/App.tsx
git commit -m "feat: withdrawals page (L2->L1) from withdrawal_utxos"
```

---

### Task 9: Forced transactions surface

**Files:**
- Create: `backend/src/db/forcedTransactions.ts`, `backend/src/server/routes/forcedTransactions.ts`
- Modify: `backend/src/server/routes.ts`
- Create: `frontend/src/api/forcedTransactions.ts`, `frontend/src/pages/ForcedTransactions.tsx`
- Modify: `frontend/src/App.tsx` (+nav link)

**Interfaces:**
- Produces: `GET /api/forced-transactions/:page` → page envelope with `ForcedTxRow = { tx_order_id: string; tx_order_l1_tx_hash: string; tx_order_l1_output_index: number; tx_id: string; operator_validity: "TxIsValid" | "NonExistentInputUtxo" | "InvalidSignature" | "FailedScript" | "FeeTooLow" | "UnbalancedTx"; status: "awaiting" | "projected" | "finalized"; inclusion_time: string; projected_header_hash: string | null }`.

- [ ] **Step 1: DB reader** — same LIMIT-25 pagination pattern as Tasks 7/8 over:

```sql
SELECT tx_order_id, tx_order_l1_tx_hash, tx_order_l1_output_index, tx_id,
       operator_validity, status, inclusion_time, projected_header_hash
FROM forced_transaction_utxos
ORDER BY inclusion_time DESC, tx_order_id DESC
LIMIT ${LIMIT + 1} OFFSET ${offset};
```

(Display metadata only — do not decode `tx_compact`; the compact form needs witness-hash preimages we don't resolve here. `tx_id` links to `/transaction/:hash`, which shows the full decoded tx once the node admits it.)

- [ ] **Step 2: Route + page** — mirror Task 8. `operator_validity` badge: `TxIsValid` green, the 5 failure codes red with the code as the label. Route `/forced-transactions/:page`, nav link "Forced Txs".

- [ ] **Step 3: Verify + commit**

Typecheck + build clean; `curl -s http://localhost:3101/api/forced-transactions/1` returns the envelope (empty rows fine).

```bash
git add backend/src/db/forcedTransactions.ts backend/src/server/routes/forcedTransactions.ts backend/src/server/routes.ts frontend/src/api/forcedTransactions.ts frontend/src/pages/ForcedTransactions.tsx frontend/src/App.tsx
git commit -m "feat: forced transactions page from forced_transaction_utxos"
```

---

### Task 10: Final sweep — docs, dead code, code review

**Files:**
- Modify: `README.md` (mention the new surfaces + the node-DB-reset requirement for tx-validation ≥ 2026-07-07)
- Delete: `backend/scripts/decode-smoke.ts` **only if** Harun confirms it is no longer wanted (it is a temp debug tool per project memory — ask, don't assume)

- [ ] **Step 1: Update README** — one short section: what the explorer displays now (txs with lifecycle status, blocks with DA metadata + finalization, address balances from the spendable mempool ledger, deposits, withdrawals, forced txs), and the operational note that a pre-2026-07-07 node DB volume must be recreated.
- [ ] **Step 2: Full verification** — backend `pnpm typecheck`, frontend `pnpm build`, and click through every page against the live dev node (home, blocks list, block detail, txs list, tx detail incl. one pending and one rejected if available, address, deposits, withdrawals, forced txs).
- [ ] **Step 3: Request code review** — run `/code-review` on the branch before declaring done (superpowers:requesting-code-review).
- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document tx-validation resync surfaces and node DB reset note"
```

---

## Explicitly out of scope (decided, not forgotten)

- **Codec tarball re-vendor** — decode API and CDDL unchanged; nothing here needs `da-transport`. Re-vendor only when we decode DA payload bodies.
- **Node HTTP API proxy** (`/tx-status`, `/pipeline-status`) — Postgres-direct replication chosen for consistency and no new config/runtime dependency; revisit if status logic drifts.
- **`awaiting_local_recovery` status** — needs node-process in-memory globals; not visible from Postgres.
- **Test infrastructure** — roadmap Phase 4; this plan verifies via typecheck/build + live smoke checks (declared above).
- **Decoding `forced_transaction_utxos.tx_compact`** — compact form; link to the tx page instead.
- **`deposit-status` per-event page, home stat tiles, bech32 for withdrawal L1 addresses** — nice-to-haves after the surfaces exist.
