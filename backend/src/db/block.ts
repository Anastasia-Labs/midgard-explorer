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

export async function getLastBlocks(count: number) {
  const latestHeights = await prisma.blocks.findMany({
    distinct: ["header_hash"],
    orderBy: { height: "desc" },
    take: count,
    select: { header_hash: true },
  });
  const headerHashes = latestHeights.map((row) => row.header_hash);
  if (headerHashes.length === 0) {
    return [];
  }
  return prisma.blocks.findMany({
    where: { header_hash: { in: headerHashes } },
    orderBy: { height: "desc" },
  });
}

export async function getLastTransactions(count: number) {
  return prisma.blocks.findMany({ orderBy: { height: "desc" }, take: count });
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

export async function getBlocksPage(page: number) {
  const limit = config.BLOCKS_PER_PAGE;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const [rows, total] = await Promise.all([
    prisma.blocks.findMany({
      distinct: ["header_hash"],
      orderBy: { height: "desc" },
      skip: (safePage - 1) * limit,
      take: limit,
      select: {
        header_hash: true,
        time_stamp_tz: true,
      },
    }),
    prisma.blocks.groupBy({ by: ["header_hash"] }).then((res) => res.length),
  ]);
  const hasNextPage = safePage * limit < total;
  return { rows, hasNextPage, total, limit };
}
