import { Request, Response } from "express";
import {
  getL1BlockHeaders,
  getL1Summary,
  getL1Transaction,
  getL1TransactionsPage,
} from "../../db/l1";

/** Midgard's on-chain footprint on Cardano, read from the explorer's own
 * store. Unlike the rest of the API these answer whether or not the Midgard
 * node is running, because the data came from the chain rather than the node. */

export async function getL1SummaryRoute(_req: Request, res: Response) {
  return res.json(await getL1Summary());
}

export async function getL1TransactionsPageRoute(req: Request, res: Response) {
  const page = Number(req.params.page);
  return res.json(await getL1TransactionsPage(page));
}

export async function getL1TransactionRoute(req: Request, res: Response) {
  const txHash = String(req.query.txHash ?? "");
  if (!/^[0-9a-f]{64}$/.test(txHash)) {
    return res.status(400).json({ error: "txHash must be 64 hex characters." });
  }
  const tx = await getL1Transaction(txHash);
  if (!tx) return res.status(404).json({ error: "Not found." });
  return res.json(tx);
}

export async function getL1BlockHeadersRoute(req: Request, res: Response) {
  const limit = Number(req.query.limit ?? 25);
  return res.json(await getL1BlockHeaders(limit));
}
