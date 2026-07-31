import { prisma } from "../db";
import { config } from "../config";
import { toHex } from "../utils";

export async function getAllBlocks() {
  return prisma.blocks.findMany();
}

export async function getBlock(headerHash: string) {
  const bytes = Buffer.from(headerHash, "hex");
  return prisma.$queryRaw<
    Array<{
      height: number;
      header_hash: Uint8Array;
      tx_id: Uint8Array;
      time_stamp_tz: Date;
      tx: Uint8Array | null;
    }>
  >`SELECT b.height,
      b.header_hash,
      b.tx_id,
      b.time_stamp_tz,
      COALESCE(i.tx, m.tx) AS tx
    FROM blocks AS b
    LEFT JOIN immutable AS i
      ON b.tx_id = i.tx_id
    LEFT JOIN mempool AS m
      ON b.tx_id = m.tx_id
    WHERE b.header_hash = ${bytes}
    ORDER BY b.height DESC;`;
}

/** One row per block, same shape as the blocks list so the overview panel and
 * the list page say the same things about a block. */
export async function getLastBlocks(count: number) {
  return prisma.$queryRaw<
    Array<{
      height: number;
      header_hash: Uint8Array;
      tx_id: Uint8Array;
      time_stamp_tz: Date;
      tx_count: bigint;
      finalization_status: string | null;
    }>
  >`SELECT b.height,
      b.header_hash,
      MIN(b.tx_id) AS tx_id,
      MAX(b.time_stamp_tz) AS time_stamp_tz,
      COUNT(*)::bigint AS tx_count,
      MAX(f.status) AS finalization_status
    FROM blocks AS b
    LEFT JOIN pending_block_finalizations AS f
      ON f.header_hash = b.header_hash
    GROUP BY b.height, b.header_hash
    ORDER BY b.height DESC
    LIMIT ${count};`;
}

export async function getLastTransactions(count: number) {
  return prisma.$queryRaw<
    Array<{
      height: number;
      header_hash: Uint8Array;
      tx_id: Uint8Array;
      time_stamp_tz: Date;
      in_immutable: boolean;
    }>
  >`SELECT b.height,
      b.header_hash,
      b.tx_id,
      b.time_stamp_tz,
      (i.tx_id IS NOT NULL) AS in_immutable
    FROM blocks AS b
    LEFT JOIN immutable AS i
      ON i.tx_id = b.tx_id
    ORDER BY b.height DESC
    LIMIT ${count};`;
}

/** Height is what people read off a block page and type back into search, so it
 * resolves to the canonical header hash. `blocks` holds one row per block-tx
 * pair; every row for a height carries the same header hash. */
export async function getBlockHashByHeight(height: number) {
  const row = await prisma.blocks.findFirst({
    where: { height },
    select: { header_hash: true },
  });
  return row?.header_hash ?? null;
}

export async function getTotalBlocks() {
  const rows = await prisma.blocks.groupBy({ by: ["header_hash"] });
  return rows.length;
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
    FROM pending_block_finalizations
    WHERE header_hash = ${key};`;
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

/** One row per block, carrying what a reader needs to choose which block to
 * open: its height, how much it holds, and where it stands on L1. The counts
 * come from `blocks` itself, which holds one row per block-tx pair. */
export async function getBlocksPage(page: number, status?: string) {
  const limit = config.BLOCKS_PER_PAGE;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * limit;
  // Narrowing happens in SQL. A filter applied to the rows that happened to
  // arrive would look like it searches the chain and in fact search one screen.
  const filter = status && status.length > 0 ? status : null;
  const [rows, total] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        height: number;
        header_hash: Uint8Array;
        time_stamp_tz: Date;
        tx_count: bigint;
        finalization_status: string | null;
      }>
    >`SELECT b.height,
        b.header_hash,
        MAX(b.time_stamp_tz) AS time_stamp_tz,
        COUNT(*)::bigint AS tx_count,
        MAX(f.status) AS finalization_status
      FROM blocks AS b
      LEFT JOIN pending_block_finalizations AS f
        ON f.header_hash = b.header_hash
      WHERE ${filter}::text IS NULL OR f.status = ${filter}
      GROUP BY b.height, b.header_hash
      ORDER BY b.height DESC
      OFFSET ${offset}
      LIMIT ${limit};`,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT b.header_hash)::bigint AS n
        FROM blocks AS b
        LEFT JOIN pending_block_finalizations AS f
          ON f.header_hash = b.header_hash
       WHERE ${filter}::text IS NULL OR f.status = ${filter};`.then((r) =>
      Number(r[0]?.n ?? 0n),
    ),
  ]);
  const hasNextPage = safePage * limit < total;
  return { rows, hasNextPage, total, limit };
}
