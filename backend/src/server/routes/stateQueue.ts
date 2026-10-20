import { Request, Response } from "express";
import { config } from "../../config";
import { loadManifest } from "../../db/manifest";
import { getStateQueue } from "../../db/stateQueue";
import { cached } from "../cache";

/** The manifest's block maturity, or null where none is configured or it
 * cannot be read: the queue is still worth showing without it. */
const blockMaturityMs = (): number | null => {
  try {
    return loadManifest(config.MIDGARD_MANIFEST_PATH).blockMaturityMs;
  } catch {
    return null;
  }
};

/** The Blocks page's queue view polls this every few seconds per viewer, so
 * one reading serves every viewer for three seconds: well under a block, and
 * five statements against the node however many pages are open. */
const readStateQueue = cached("state-queue", 3_000, () =>
  getStateQueue(undefined, blockMaturityMs()),
);

export async function getStateQueueRoute(_req: Request, res: Response) {
  return res.json(await readStateQueue());
}
