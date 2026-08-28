import { config } from "../config";
import { prisma } from "../db";
import { toHex } from "../utils";

export type BlockTxRecord = {
  height: number | null;
  header_hash: Uint8Array;
  tx_id: Uint8Array;
  time_stamp_tz: Date;
  tx: Uint8Array | null;
  ordinal: number;
};

/** Durable transaction membership comes from the finalization journal. The
 * legacy `blocks` table is only a source of its nullable row identifier; the
 * node clears those rows after merge. The second arm preserves old block-only
 * records without duplicating a transaction that already has journal evidence. */
export async function getBlock(headerHash: string) {
  const key = Buffer.from(headerHash, "hex");
  return prisma.$queryRaw<BlockTxRecord[]>`
    WITH legacy AS (
      SELECT header_hash, MIN(height)::int AS height
        FROM blocks
       WHERE header_hash = ${key}
       GROUP BY header_hash
    ), members AS (
      SELECT l.height,
             j.header_hash,
             j.member_id AS tx_id,
             j.source_time_stamp_tz AS time_stamp_tz,
             j.payload_cbor AS tx,
             j.ordinal
        FROM pending_block_finalization_txs AS j
        LEFT JOIN legacy AS l ON l.header_hash = j.header_hash
       WHERE j.header_hash = ${key}
      UNION ALL
      SELECT MIN(peer.height)::int AS height,
             b.header_hash,
             b.tx_id,
             b.time_stamp_tz,
             COALESCE(i.tx, m.tx) AS tx,
             b.height AS ordinal
        FROM blocks AS b
        JOIN blocks AS peer ON peer.header_hash = b.header_hash
        LEFT JOIN immutable AS i ON i.tx_id = b.tx_id
        LEFT JOIN mempool AS m ON m.tx_id = b.tx_id
       WHERE b.header_hash = ${key}
         AND NOT EXISTS (
           SELECT 1 FROM pending_block_finalization_txs AS j
            WHERE j.header_hash = b.header_hash AND j.member_id = b.tx_id
         )
       GROUP BY b.header_hash, b.tx_id, b.time_stamp_tz,
                COALESCE(i.tx, m.tx), b.height
    )
    SELECT * FROM members ORDER BY ordinal ASC;`;
}

export type BlockHeaderRecord = {
  header_hash: Uint8Array;
  height: number | null;
  block_start_time: Date | null;
  block_end_time: Date;
  header_l2_transaction_count: bigint | null;
  header_deposit_count: bigint | null;
  header_withdrawal_count: bigint | null;
  header_forced_transaction_count: bigint | null;
  materialized_l2_transaction_count: bigint;
  payload_retained_locally: boolean;
};

/** One header summary. The journal is authoritative when present; DA and
 * `blocks` are detail-only compatibility fallbacks so an orphaned legacy row
 * remains inspectable without becoming part of the canonical header list. */
export async function getBlockHeader(headerHash: string) {
  const key = Buffer.from(headerHash, "hex");
  const rows = await prisma.$queryRaw<BlockHeaderRecord[]>`
    WITH materialized AS (
      SELECT header_hash, MIN(height)::int AS height, COUNT(*)::bigint AS count,
             MAX(time_stamp_tz) AS block_end_time
        FROM blocks WHERE header_hash = ${key} GROUP BY header_hash
    )
    SELECT COALESCE(f.header_hash, d.header_hash, b.header_hash) AS header_hash,
           b.height,
           COALESCE(f.block_start_time, d.block_start_time) AS block_start_time,
           COALESCE(f.block_end_time, d.block_end_time, b.block_end_time) AS block_end_time,
           COALESCE(f.expected_l2_transaction_count, d.l2_transaction_count) AS header_l2_transaction_count,
           COALESCE(f.expected_deposit_count, d.deposit_count) AS header_deposit_count,
           COALESCE(f.expected_withdrawal_count, d.withdrawal_count) AS header_withdrawal_count,
           COALESCE(f.expected_forced_transaction_count, d.forced_transaction_count) AS header_forced_transaction_count,
           COALESCE(b.count, 0)::bigint AS materialized_l2_transaction_count,
           (d.header_hash IS NOT NULL) AS payload_retained_locally
      FROM pending_block_finalizations AS f
      FULL OUTER JOIN da_payloads AS d ON d.header_hash = f.header_hash
      FULL OUTER JOIN materialized AS b
        ON b.header_hash = COALESCE(f.header_hash, d.header_hash)
     WHERE COALESCE(f.header_hash, d.header_hash, b.header_hash) = ${key};`;
  return rows[0] ?? null;
}

export type BlockListRecord = {
  height: number | null;
  header_hash: Uint8Array;
  tx_id: Uint8Array | null;
  block_start_time: Date;
  block_end_time: Date;
  header_l2_transaction_count: bigint;
  header_deposit_count: bigint;
  header_withdrawal_count: bigint;
  header_forced_transaction_count: bigint;
  materialized_l2_transaction_count: bigint;
  payload_retained_locally: boolean;
  finalization_status: string;
};

const listSelect = async (count: number): Promise<BlockListRecord[]> =>
  prisma.$queryRaw<BlockListRecord[]>`
    WITH legacy AS (
      SELECT header_hash, MIN(height)::int AS height, COUNT(*)::bigint AS count
        FROM blocks GROUP BY header_hash
    ), first_tx AS (
      SELECT DISTINCT ON (header_hash) header_hash, member_id
        FROM pending_block_finalization_txs
       ORDER BY header_hash, ordinal ASC
    )
    SELECT f.header_hash,
           l.height,
           t.member_id AS tx_id,
           f.block_start_time,
           f.block_end_time,
           f.expected_l2_transaction_count AS header_l2_transaction_count,
           f.expected_deposit_count AS header_deposit_count,
           f.expected_withdrawal_count AS header_withdrawal_count,
           f.expected_forced_transaction_count AS header_forced_transaction_count,
           COALESCE(l.count, 0)::bigint AS materialized_l2_transaction_count,
           (d.header_hash IS NOT NULL) AS payload_retained_locally,
           f.status AS finalization_status
      FROM pending_block_finalizations AS f
      LEFT JOIN legacy AS l ON l.header_hash = f.header_hash
      LEFT JOIN first_tx AS t ON t.header_hash = f.header_hash
      LEFT JOIN da_payloads AS d ON d.header_hash = f.header_hash
     ORDER BY f.block_end_time DESC, encode(f.header_hash, 'hex') DESC
     LIMIT ${count};`;

export async function getLastBlocks(count: number) {
  return listSelect(count);
}

/** Recent committed transaction membership also survives `blocks` cleanup. */
export async function getLastTransactions(count: number) {
  return prisma.$queryRaw<
    Array<{
      height: number | null;
      header_hash: Uint8Array;
      tx_id: Uint8Array;
      time_stamp_tz: Date;
      finalization_status: string;
    }>
  >`
    WITH legacy AS (
      SELECT header_hash, MIN(height)::int AS height FROM blocks GROUP BY header_hash
    )
    SELECT l.height, j.header_hash, j.member_id AS tx_id,
           j.source_time_stamp_tz AS time_stamp_tz,
           f.status AS finalization_status
      FROM pending_block_finalization_txs AS j
      JOIN pending_block_finalizations AS f ON f.header_hash = j.header_hash
      LEFT JOIN legacy AS l ON l.header_hash = j.header_hash
     ORDER BY f.block_end_time DESC, encode(f.header_hash, 'hex') DESC, j.ordinal ASC
     LIMIT ${count};`;
}

/** Retained for typed height lookups over transaction-bearing legacy rows. */
export async function getBlockHashByHeight(height: number) {
  const row = await prisma.blocks.findFirst({
    where: { height },
    select: { header_hash: true },
  });
  return row?.header_hash ?? null;
}

export async function getTotalBlocks() {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM pending_block_finalizations;`;
  return Number(rows[0]?.n ?? 0n);
}

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
    Array<{
      status: string;
      submitted_tx_hash: Uint8Array | null;
      block_end_time: Date;
      created_at: Date;
      updated_at: Date;
      observed_confirmed_at_ms: bigint | null;
    }>
  >`SELECT status, submitted_tx_hash, block_end_time, created_at, updated_at,
      observed_confirmed_at_ms
    FROM pending_block_finalizations WHERE header_hash = ${key};`;
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    submitted_tx_hash: row.submitted_tx_hash
      ? toHex(row.submitted_tx_hash)
      : null,
    blockEndTime: row.block_end_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    observedConfirmedAt:
      row.observed_confirmed_at_ms === null
        ? null
        : new Date(Number(row.observed_confirmed_at_ms)),
  };
}

export type BlockEventMember = {
  member_id: Uint8Array;
  ordinal: number;
  source_time_stamp_tz: Date;
};

/** IDs and order are enough to connect a header to the existing bridge pages;
 * payload bytes remain in the raw node journal and are not duplicated in JSON. */
export async function getBlockEvents(headerHash: string) {
  const key = Buffer.from(headerHash, "hex");
  const [deposits, withdrawals, forcedTransactions] = await Promise.all([
    prisma.$queryRaw<BlockEventMember[]>`
      SELECT member_id, ordinal, source_time_stamp_tz
        FROM pending_block_finalization_deposits
       WHERE header_hash = ${key} ORDER BY ordinal ASC;`,
    prisma.$queryRaw<BlockEventMember[]>`
      SELECT member_id, ordinal, source_time_stamp_tz
        FROM pending_block_finalization_withdrawals
       WHERE header_hash = ${key} ORDER BY ordinal ASC;`,
    prisma.$queryRaw<BlockEventMember[]>`
      SELECT member_id, ordinal, source_time_stamp_tz
        FROM pending_block_finalization_forced_transactions
       WHERE header_hash = ${key} ORDER BY ordinal ASC;`,
  ]);
  return { deposits, withdrawals, forcedTransactions };
}

export async function getBlocksPage(page: number, status?: string) {
  const limit = config.BLOCKS_PER_PAGE;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * limit;
  const filter = status && status.length > 0 ? status : null;
  const [rows, total] = await Promise.all([
    prisma.$queryRaw<BlockListRecord[]>`
      WITH legacy AS (
        SELECT header_hash, MIN(height)::int AS height, COUNT(*)::bigint AS count
          FROM blocks GROUP BY header_hash
      ), first_tx AS (
        SELECT DISTINCT ON (header_hash) header_hash, member_id
          FROM pending_block_finalization_txs
         ORDER BY header_hash, ordinal ASC
      )
      SELECT f.header_hash, l.height, t.member_id AS tx_id,
             f.block_start_time, f.block_end_time,
             f.expected_l2_transaction_count AS header_l2_transaction_count,
             f.expected_deposit_count AS header_deposit_count,
             f.expected_withdrawal_count AS header_withdrawal_count,
             f.expected_forced_transaction_count AS header_forced_transaction_count,
             COALESCE(l.count, 0)::bigint AS materialized_l2_transaction_count,
             (d.header_hash IS NOT NULL) AS payload_retained_locally,
             f.status AS finalization_status
        FROM pending_block_finalizations AS f
        LEFT JOIN legacy AS l ON l.header_hash = f.header_hash
        LEFT JOIN first_tx AS t ON t.header_hash = f.header_hash
        LEFT JOIN da_payloads AS d ON d.header_hash = f.header_hash
       WHERE ${filter}::text IS NULL OR f.status = ${filter}
       ORDER BY f.block_end_time DESC, encode(f.header_hash, 'hex') DESC
       OFFSET ${offset} LIMIT ${limit};`,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pending_block_finalizations
       WHERE ${filter}::text IS NULL OR status = ${filter};`.then((r) =>
      Number(r[0]?.n ?? 0n),
    ),
  ]);
  return {
    rows,
    hasNextPage: safePage * limit < total,
    total,
    limit,
  };
}

export type BlockNeighbours = {
  prev: { height: number | null; header_hash: Uint8Array } | null;
  next: { height: number | null; header_hash: Uint8Array } | null;
};

/** Adjacent journaled headers in the same deterministic order as the list.
 * `prev` is earlier and `next` is later. They are hash-addressed because a
 * header need never have a row in `blocks`. */
export async function getBlockNeighbours(
  headerHash: string,
): Promise<BlockNeighbours> {
  const key = Buffer.from(headerHash, "hex");
  const rows = await prisma.$queryRaw<
    Array<{
      prev_hash: Uint8Array | null;
      prev_height: number | null;
      next_hash: Uint8Array | null;
      next_height: number | null;
    }>
  >`
    WITH legacy AS (
      SELECT header_hash, MIN(height)::int AS height FROM blocks GROUP BY header_hash
    ), ordered AS (
      SELECT f.header_hash, l.height,
             LAG(f.header_hash) OVER (
               ORDER BY f.block_end_time ASC, encode(f.header_hash, 'hex') ASC
             ) AS prev_hash,
             LAG(l.height) OVER (
               ORDER BY f.block_end_time ASC, encode(f.header_hash, 'hex') ASC
             ) AS prev_height,
             LEAD(f.header_hash) OVER (
               ORDER BY f.block_end_time ASC, encode(f.header_hash, 'hex') ASC
             ) AS next_hash,
             LEAD(l.height) OVER (
               ORDER BY f.block_end_time ASC, encode(f.header_hash, 'hex') ASC
             ) AS next_height
        FROM pending_block_finalizations AS f
        LEFT JOIN legacy AS l ON l.header_hash = f.header_hash
    )
    SELECT prev_hash, prev_height, next_hash, next_height
      FROM ordered WHERE header_hash = ${key};`;
  const row = rows[0];
  if (!row) return { prev: null, next: null };
  return {
    prev: row.prev_hash
      ? { height: row.prev_height, header_hash: row.prev_hash }
      : null,
    next: row.next_hash
      ? { height: row.next_height, header_hash: row.next_hash }
      : null,
  };
}
