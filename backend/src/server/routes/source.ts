import { Request, Response } from "express";
import { getDeploymentContext } from "../../db/deployment";

/**
 * Which Midgard this is, which database the figures came from, and how current
 * that database is.
 *
 * It exists because of a real failure: the explorer read a phase-4 test
 * database for weeks and presented it as the live chain, and the cause was one
 * line in a gitignored `.env` that appeared in no diff. Every page's banner is
 * built from this, so the answer has to be cheap and it has to come from the
 * node's own database rather than from configuration alone.
 *
 * It used to ride on the Cardano index's summary payload. That made a banner
 * about the Midgard source depend on a second database, so when the index was
 * unavailable every page announced "the backend could not be reached" while the
 * backend was serving Midgard data perfectly.
 */
export async function getSourceRoute(_req: Request, res: Response) {
  return res.json(await getDeploymentContext());
}
