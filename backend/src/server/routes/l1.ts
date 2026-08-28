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
import { parseHexOfLength } from "../validate";

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
  // Coerced, not rejected. See the convention note above: a page number is a
  // navigation hint and there is no wrong resource to serve.
  const page = Number(req.params.page);
  return res.json(await getL1TransactionsPage(page));
}

export async function getL1TransactionRoute(req: Request, res: Response) {
  const parsed = parseHexOfLength(req.query.txHash, 64, "txHash");
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const tx = await getL1Transaction(parsed.value);
  if (!tx) return res.status(404).json({ error: "Not found." });
  return res.json(tx);
}

export async function getL1BlockHeadersRoute(req: Request, res: Response) {
  const limit = Number(req.query.limit ?? 25);
  return res.json(await getL1BlockHeaders(limit));
}

export async function getL1BlockHeaderRoute(req: Request, res: Response) {
  const parsed = parseHexOfLength(req.query.headerHash, 56, "headerHash");
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const header = await getL1BlockHeader(parsed.value);
  if (!header) return res.status(404).json({ error: "Not found." });
  return res.json(header);
}

export async function getL1ValidatorRoute(req: Request, res: Response) {
  const parsed = parseHexOfLength(req.query.scriptHash, 56, "scriptHash");
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const validator = await getL1Validator(parsed.value);
  if (!validator) return res.status(404).json({ error: "Not found." });
  return res.json(validator);
}

/** Midgard's deposits, newest first. The decoded datum is what makes a row
 * readable; a deposit whose datum did not decode is still listed. */
export async function getL1DepositsRoute(req: Request, res: Response) {
  const limit = Number(req.query.limit ?? 25);
  return res.json(await getL1Deposits(limit));
}
