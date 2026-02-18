import { Request, Response } from "express";
import { config } from "../../config";
import {
  getBlock,
  getBlocksPage,
  getLastBlocks,
  getTotalBlocks,
} from "../../db/block";
import { toHex } from "../../utils";

export async function getBlockRoute(req: Request, res: Response) {
  const headerHash = req.query.header_hash;
  if (typeof headerHash !== "string" || headerHash.length === 0) {
    return res.status(400).json({ error: "Missing header_hash query param." });
  }

  const rows = await getBlock(headerHash);
  if (rows.length === 0) {
    return res.status(404).json({ error: "Block not found." });
  }

  const payload = rows.map((row) => ({
    ...row,
    header_hash: toHex(row.header_hash),
    tx_id: toHex(row.tx_id),
    tx: row.tx ? toHex(row.tx) : null,
  }));
  return res.json({ rows: payload });
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
    ...row,
    header_hash: toHex(row.header_hash),
  }));
  return res.json({ rows: payload, hasNextPage, total, limit });
}
