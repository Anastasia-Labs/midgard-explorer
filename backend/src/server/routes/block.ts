import { Request, Response } from "express";
import { config } from "../../config";
import {
  getBlock,
  getBlockDaMetadata,
  getBlockHashByHeight,
  getBlockFinalization,
  getBlocksPage,
  getLastBlocks,
  getTotalBlocks,
} from "../../db/block";
import { decodeTransactionSafe } from "../../decode/transaction";
import { isHexOfLength, toHex } from "../../utils";

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

  const rows = await getBlock(headerHash);
  if (rows.length === 0) {
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
  const [da, finalization] = await Promise.all([
    getBlockDaMetadata(headerHash),
    getBlockFinalization(headerHash),
  ]);
  return res.json({ rows: payload, da, finalization });
}

export async function getRecentBlocksRoute(_req: Request, res: Response) {
  const rows = await getLastBlocks(config.RECENT_BLOCKS_LIMIT);
  const payload = rows.map((row) => ({
    ...row,
    header_hash: toHex(row.header_hash),
    tx_id: toHex(row.tx_id),
  }));
  return res.json({ rows: payload });
}

export async function getTotalBlocksRoute(_req: Request, res: Response) {
  const total = await getTotalBlocks();
  return res.json({ total });
}

export async function getBlocksPageRoute(req: Request, res: Response) {
  const page = Number(req.params.page);
  if (!Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: "Invalid page." });
  }

  const { rows, hasNextPage, total, limit } = await getBlocksPage(page);
  const payload = rows.map((row) => ({
    height: row.height,
    header_hash: toHex(row.header_hash),
    time_stamp_tz: row.time_stamp_tz,
    tx_count: Number(row.tx_count),
    finalization_status: row.finalization_status,
  }));
  return res.json({ rows: payload, hasNextPage, total, limit });
}
