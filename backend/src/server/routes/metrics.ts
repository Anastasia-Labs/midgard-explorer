import { Request, Response } from "express";
import { getMetrics } from "../../db/metrics";

/** The overview's operational panel. Read-only aggregates over the node's own
 * tables; nothing here is cached or estimated, so a reader refreshing the page
 * sees the node's current state rather than a snapshot of some earlier one. */
export async function getMetricsRoute(_req: Request, res: Response) {
  const metrics = await getMetrics();
  return res.json(metrics);
}
