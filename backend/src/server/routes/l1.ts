import { Request, Response } from "express";
import {
  PAGE_SIZE,
  getCardanoActivityPage,
  getCardanoActivitySummary,
  getCardanoReferences,
} from "../../db/cardanoActivity";
import { getValidator, listValidators } from "../../db/l1";
import { getDeploymentContext } from "../../db/deployment";
import { parseHexOfLength, parseHintedPage } from "../validate";

/**
 * Midgard's Cardano footprint, as the node recorded it.
 *
 * These read the node's own database and the deployment manifest. Nothing here
 * observes Cardano, so nothing here can find a transaction the node never
 * mentioned, and no response may be presented as a confirmation. Every payload
 * carries the deployment context, which says which Midgard this is and how
 * current the records are, so a reader is never given a hash without being told
 * where it came from.
 *
 * Two conventions live here on purpose, and this is the ruling rather than an
 * oversight:
 *
 * - A **page number** is a navigation hint, so a bad one is coerced to the
 *   first page. Returning 400 for `?page=abc` would break a link rather than
 *   show the reader something useful, and there is no wrong resource to serve.
 * - An **identifier** names one specific resource, so a malformed one is a 400.
 *   Coercing it would answer a question the caller did not ask.
 */

export async function getCardanoActivityRoute(req: Request, res: Response) {
  // A malformed page is coerced to the first, per the convention note above.
  // Depth is a different question and is refused: see `parseHintedPage`.
  const parsedPage = parseHintedPage(req.params.page, PAGE_SIZE);
  if (!parsedPage.ok) return res.status(400).json({ error: parsedPage.error });
  const [activity, midgard] = await Promise.all([
    getCardanoActivityPage(parsedPage.value),
    getDeploymentContext(),
  ]);
  return res.json({ midgard, ...activity });
}

export async function getCardanoActivitySummaryRoute(_req: Request, res: Response) {
  const [summary, midgard] = await Promise.all([
    getCardanoActivitySummary(),
    getDeploymentContext(),
  ]);
  return res.json({ midgard, ...summary });
}

/**
 * What Midgard records about one Cardano transaction.
 *
 * Empty `references` is a real answer and not a 404: the node holds no record
 * naming this hash. It is deliberately NOT "this transaction does not exist",
 * which is a claim about Cardano that nothing here is entitled to make.
 */
export async function getCardanoReferenceRoute(req: Request, res: Response) {
  const parsed = parseHexOfLength(req.query.txHash, 64, "txHash");
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const [references, midgard] = await Promise.all([
    getCardanoReferences(parsed.value),
    getDeploymentContext(),
  ]);
  return res.json({ midgard, txHash: parsed.value, references });
}

export async function getValidatorsRoute(_req: Request, res: Response) {
  const [midgard, validators] = await Promise.all([
    getDeploymentContext(),
    Promise.resolve(listValidators()),
  ]);
  return res.json({ midgard, ...validators });
}

export async function getValidatorRoute(req: Request, res: Response) {
  const parsed = parseHexOfLength(req.query.scriptHash, 56, "scriptHash");
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const found = getValidator(parsed.value);
  // 404 here is about the MANIFEST, not about Cardano: this deployment declares
  // no such validator. A script hash absent from the manifest may well exist on
  // chain, and this says nothing either way.
  if (found === null) return res.status(404).json({ error: "Not found." });
  const midgard = await getDeploymentContext();
  return res.json({ midgard, ...found });
}
