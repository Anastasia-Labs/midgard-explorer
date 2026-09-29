import type { FreshnessState, SourceKind } from "@midgard-explorer/contracts";
import type { JourneySource } from "./journey";

/** Reader-facing words for codes the backend sends. The code stays in the API
 * response; the page shows these. */

const NETWORKS: Record<string, string> = {
  mainnet: "Mainnet",
  preprod: "Preprod",
  preview: "Preview",
};
export const networkName = (n: string): string => NETWORKS[n] ?? n;

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  // Not "live": the freshness words beside it say whether it is.
  primary: "Node database",
  replica: "Replica of the node database",
  snapshot: "Snapshot of the node database",
  fixture: "Demo data",
};

export const FRESHNESS_LABEL: Record<FreshnessState, string> = {
  live: "up to date",
  lagging: "behind",
  stale: "stale",
  fixed: "fixed at one point in time",
  synthetic: "not live",
  unknown: "freshness unknown",
};

export const JOURNEY_SOURCE_LABEL: Record<JourneySource, string> = {
  tx_admissions: "Node admission record",
  blocks: "Block record",
  pending_block_finalizations: "Settlement record",
  bridge: "Bridge record",
};

export const purposeLabel = (p: string): string => (p === "None" ? "Not stated" : p);
