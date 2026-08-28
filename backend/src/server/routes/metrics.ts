import { Request, Response } from "express";
import { getMetrics } from "../../db/metrics";
import { cached } from "../cache";

/** The overview's operational panel. Read-only aggregates over the node's own
 * tables, nothing estimated.
 *
 * Held for ten seconds. One uncached request is 13 database queries against
 * the node, so request rate and query load were the same number, and the node
 * is a machine this explorer does not own. Ten seconds is shorter than a block
 * and shorter than a reader's refresh reflex, so the panel still shows the
 * node's current state rather than a snapshot of some earlier one. */
const readMetrics = cached("metrics", 10_000, getMetrics);

export async function getMetricsRoute(_req: Request, res: Response) {
  return res.json(await readMetrics());
}
