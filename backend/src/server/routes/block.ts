import { Request, Response } from "express";
import { config } from "../../config";
import {
  getBlock,
  getBlockDaMetadata,
  getBlockEvents,
  getBlockHeader,
  getBlockHashByHeight,
  getBlockFinalization,
  getBlockNeighbours,
  getBlocksPage,
  getLastBlocks,
  getTotalBlocks,
} from "../../db/block";
import { decodeTransactionSafe } from "../../decode/transaction";
import { isHexOfLength, toHex } from "../../utils";
import { parsePageParam } from "../validate";

export async function getBlockByHeightRoute(req: Request, res: Response) {
  const height = Number(req.params.height);
  if (!Number.isSafeInteger(height) || height < 0) {
    return res.status(400).json({ error: "Invalid height." });
  }
  const hash = await getBlockHashByHeight(height);
  if (hash === null) {
    return res.status(404).json({ error: "Block not found." });
  }
  return res.json({ header_hash: toHex(hash) });
}

export async function getBlockRoute(req: Request, res: Response) {
  const headerHash = req.query.header_hash;
  if (typeof headerHash !== "string" || headerHash.length === 0) {
    return res.status(400).json({ error: "Missing header_hash query param." });
  }
  if (!isHexOfLength(headerHash, 56)) {
    return res.status(400).json({ error: "Invalid header_hash." });
  }

  const [header, rows, da, finalization, neighbours, events] =
    await Promise.all([
      getBlockHeader(headerHash),
      getBlock(headerHash),
      getBlockDaMetadata(headerHash),
      getBlockFinalization(headerHash),
      getBlockNeighbours(headerHash),
      getBlockEvents(headerHash),
    ]);
  if (header === null) {
    return res.status(404).json({ error: "Block not found." });
  }

  const payload = await Promise.all(
    rows.map(async (row) => {
      const decoded = row.tx
        ? await decodeTransactionSafe(row.tx)
        : { transaction: null, error: "Missing tx bytes." as string };
      return {
        height: row.height,
        header_hash: toHex(row.header_hash),
        tx_id: toHex(row.tx_id),
        time_stamp_tz: row.time_stamp_tz,
        transaction: decoded.transaction,
        decodeError: decoded.error,
      };
    }),
  );
  return res.json({
    header: {
      header_hash: toHex(header.header_hash),
      height: header.height,
      block_start_time: header.block_start_time,
      block_end_time: header.block_end_time,
      header_l2_transaction_count:
        header.header_l2_transaction_count === null
          ? null
          : Number(header.header_l2_transaction_count),
      header_deposit_count:
        header.header_deposit_count === null
          ? null
          : Number(header.header_deposit_count),
      header_withdrawal_count:
        header.header_withdrawal_count === null
          ? null
          : Number(header.header_withdrawal_count),
      header_forced_transaction_count:
        header.header_forced_transaction_count === null
          ? null
          : Number(header.header_forced_transaction_count),
      materialized_l2_transaction_count: Number(
        header.materialized_l2_transaction_count,
      ),
      payload_retained_locally: header.payload_retained_locally,
    },
    rows: payload,
    da,
    finalization,
    events: {
      deposits: events.deposits.map((row) => ({
        member_id: toHex(row.member_id),
        ordinal: row.ordinal,
        source_time_stamp_tz: row.source_time_stamp_tz,
      })),
      withdrawals: events.withdrawals.map((row) => ({
        member_id: toHex(row.member_id),
        ordinal: row.ordinal,
        source_time_stamp_tz: row.source_time_stamp_tz,
      })),
      forced_transactions: events.forcedTransactions.map((row) => ({
        member_id: toHex(row.member_id),
        ordinal: row.ordinal,
        source_time_stamp_tz: row.source_time_stamp_tz,
      })),
    },
    // Additive and nullable: a chain of one block has neither neighbour, and
    // the tip has no next.
    neighbours: {
      prev: neighbours.prev
        ? {
            height: neighbours.prev.height,
            header_hash: toHex(neighbours.prev.header_hash),
          }
        : null,
      next: neighbours.next
        ? {
            height: neighbours.next.height,
            header_hash: toHex(neighbours.next.header_hash),
          }
        : null,
    },
  });
}

export async function getRecentBlocksRoute(_req: Request, res: Response) {
  const rows = await getLastBlocks(config.RECENT_BLOCKS_LIMIT);
  const payload = rows.map((row) => ({
    height: row.height,
    header_hash: toHex(row.header_hash),
    tx_id: row.tx_id ? toHex(row.tx_id) : null,
    block_start_time: row.block_start_time,
    block_end_time: row.block_end_time,
    time_stamp_tz: row.block_end_time,
    tx_count: Number(row.header_l2_transaction_count),
    header_l2_transaction_count: Number(row.header_l2_transaction_count),
    header_deposit_count: Number(row.header_deposit_count),
    header_withdrawal_count: Number(row.header_withdrawal_count),
    header_forced_transaction_count: Number(
      row.header_forced_transaction_count,
    ),
    materialized_l2_transaction_count: Number(
      row.materialized_l2_transaction_count,
    ),
    payload_retained_locally: row.payload_retained_locally,
    finalization_status: row.finalization_status,
  }));
  return res.json({ rows: payload });
}

export async function getTotalBlocksRoute(_req: Request, res: Response) {
  const total = await getTotalBlocks();
  return res.json({ total });
}

export async function getBlocksPageRoute(req: Request, res: Response) {
  const parsedPage = parsePageParam(req.params.page);
  if (!parsedPage.ok) return res.status(400).json({ error: parsedPage.error });
  const page = parsedPage.value;

  const { rows, hasNextPage, total, limit } = await getBlocksPage(
    page,
    typeof req.query.status === "string" ? req.query.status : undefined,
  );
  const payload = rows.map((row) => ({
    height: row.height,
    header_hash: toHex(row.header_hash),
    block_start_time: row.block_start_time,
    block_end_time: row.block_end_time,
    time_stamp_tz: row.block_end_time,
    tx_count: Number(row.header_l2_transaction_count),
    header_l2_transaction_count: Number(row.header_l2_transaction_count),
    header_deposit_count: Number(row.header_deposit_count),
    header_withdrawal_count: Number(row.header_withdrawal_count),
    header_forced_transaction_count: Number(
      row.header_forced_transaction_count,
    ),
    materialized_l2_transaction_count: Number(
      row.materialized_l2_transaction_count,
    ),
    payload_retained_locally: row.payload_retained_locally,
    finalization_status: row.finalization_status,
  }));
  return res.json({ rows: payload, hasNextPage, total, limit });
}
