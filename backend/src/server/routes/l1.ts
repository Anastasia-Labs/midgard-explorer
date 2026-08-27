import { Request, Response } from "express";
import {
  getL1BlockHeaders,
  getL1BlockHeader,
  getL1Deposits,
  getL1Summary,
  getL1Transaction,
  getL1TransactionsPage,
  getL1Validator,
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

export async function getL1BlockHeaderRoute(req: Request, res: Response) {
  const headerHash = String(req.query.headerHash ?? "").toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(headerHash)) {
    return res.status(400).json({ error: "headerHash must be 56 hex characters." });
  }
  const header = await getL1BlockHeader(headerHash);
  if (!header) return res.status(404).json({ error: "Not found." });
  return res.json(header);
}

export async function getL1ValidatorRoute(req: Request, res: Response) {
  const scriptHash = String(req.query.scriptHash ?? "").toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(scriptHash)) {
    return res.status(400).json({ error: "scriptHash must be 56 hex characters." });
  }
  const validator = await getL1Validator(scriptHash);
  if (!validator) return res.status(404).json({ error: "Not found." });
  return res.json(validator);
}

/** Midgard's deposits, newest first. The decoded datum is what makes a row
 * readable; a deposit whose datum did not decode is still listed. */
export async function getL1DepositsRoute(req: Request, res: Response) {
  const limit = Number(req.query.limit ?? 25);
  return res.json(await getL1Deposits(limit));
}
