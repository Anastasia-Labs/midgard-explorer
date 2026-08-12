import { Request, Response } from "express";
import {
  getL1BlockHeaders,
  getL1Deposits,
  getL1Summary,
  getL1Transaction,
  getL1TransactionsPage,
} from "../../db/l1";

/** Midgard's on-chain footprint on Cardano, read from the explorer's own
 * store. Unlike the rest of the API these answer whether or not the Midgard
 * node is running, because the data came from the chain rather than the node.
 *
 * Two conventions live here on purpose, and this is the ruling rather than an
 * oversight:
 *
 * - A **page number** is a navigation hint, so a bad one is coerced to the
 *   first page. Returning 400 for `?page=abc` would break a link rather than
 *   show the reader something useful, and there is no wrong resource to serve.
 * - An **identifier** names one specific resource, so a malformed one is a 400.
 *   Coercing it would answer a question the caller did not ask.
 *
 * Paging stays on the path (`/transactions/:page`) because the frontend
 * already links that way; limits stay on the query string because they modify
 * a request rather than name a resource. */

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

/** Midgard's deposits, newest first. The decoded datum is what makes a row
 * readable; a deposit whose datum did not decode is still listed. */
export async function getL1DepositsRoute(req: Request, res: Response) {
  const limit = Number(req.query.limit ?? 25);
  return res.json(await getL1Deposits(limit));
}
