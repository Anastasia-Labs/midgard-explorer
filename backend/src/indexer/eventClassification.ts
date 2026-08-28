import { decodeStateQueueDatum, type BlockHeaderFields } from "./stateQueueDatum";
import { classifyEvent } from "./userEventDatum";

/** What one validator output means, given its family and its inline datum.
 *
 * Shared by the ingest loop and the re-decode script on purpose. A second copy
 * of this decision is how a backfill quietly disagrees with live ingestion:
 * the two would classify the same datum differently and neither would fail.
 *
 * `unknown` means the datum did not decode, never that the output has no
 * meaning. The raw datum is kept either way, so a decoder landing later can
 * still recover the event.
 */
export type OutputClassification = {
  eventType: string;
  decoded: Record<string, unknown> | null;
  /** Present only for a state-queue output whose datum decoded as a Midgard
   * block header. This is what the commitment tables are written from. */
  header: BlockHeaderFields | null;
};

export function classifyOutput(family: string, datumValue: unknown): OutputClassification {
  const header =
    family === "stateQueue" && datumValue !== null ? decodeStateQueueDatum(datumValue) : null;
  if (header !== null) return { eventType: "blockCommitment", decoded: null, header };
  if (datumValue === null) return { eventType: "noDatum", decoded: null, header: null };
  const user = classifyEvent(family, datumValue);
  return { eventType: user.eventType, decoded: user.decoded, header: null };
}
