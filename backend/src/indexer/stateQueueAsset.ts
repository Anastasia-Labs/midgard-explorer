import type { ValidatorEntry } from "./manifest";
import { HASH28_HEX } from "../utils";

/**
 * The canonical Midgard block header hash, read from the state-queue NFT.
 *
 * A commit transaction mints one token whose asset name is the `MBLC` prefix
 * followed by the block's 28-byte header hash. That suffix is the identity the
 * protocol itself uses: `midgard-sdk` derives it as
 * `hashHexWithBlake2b(Data.to(header, Header), 28)` and reads it back with
 * `headerHashFromStateQueueUTxO`, which drops the prefix and returns the rest.
 *
 * The indexer used to store `utxosRoot` under `headerHash` instead. That is a
 * 32-byte commitment to the UTxO set, not an identity, so every consumer that
 * asked for a block by its header hash missed, and the routes that validate a
 * 56-hex parameter could not even express the stored key.
 *
 * One function serves both callers by design. Ingest passes the assets attached
 * to the output it is classifying; the backfill passes a transaction's mints. A
 * second implementation of this rule is how a backfill silently disagrees with
 * live ingestion, which is the same reason `classifyOutput` is shared with the
 * re-decode script.
 */

/** `MBLC` in hex, which is how an asset name is stored and compared. */
export const STATE_QUEUE_BLOCK_PREFIX = "4d424c43";

/** 28 bytes, the width of a Midgard block header hash, from the one place
 * that width is named. */
const HEADER_HASH_HEX = new RegExp(`^[0-9a-f]{${HASH28_HEX}}$`);

/** Only the fields this rule reads, so the module does not depend on Koios or
 * on Prisma row shapes and can be tested with object literals. */
export type AssetRef = {
  policyId: string;
  assetName: string;
  quantity: bigint;
};

export type HeaderHashCandidate =
  | { ok: true; headerHash: string }
  | { ok: false; reason: string };

/**
 * The header hash these assets name, or why they do not name exactly one.
 *
 * Ambiguity is refused rather than resolved. A commit transaction carries both
 * the new head and the previous queue node it re-outputs, so a rule that picked
 * the first match would attribute half of them to the wrong block, and the
 * result would look entirely reasonable in the interface.
 */
export function headerHashFromStateQueueAssets(
  assets: ReadonlyArray<AssetRef>,
  policyId: string,
): HeaderHashCandidate {
  const candidates = assets.filter(
    (asset) =>
      asset.policyId === policyId &&
      asset.assetName.startsWith(STATE_QUEUE_BLOCK_PREFIX) &&
      asset.quantity > 0n,
  );

  if (candidates.length === 0) {
    return { ok: false, reason: "no state-queue block token is present" };
  }
  if (candidates.length > 1) {
    const names = candidates.map((asset) => asset.assetName).join(", ");
    return {
      ok: false,
      reason: `${candidates.length} state-queue block tokens are present (${names})`,
    };
  }

  const suffix = candidates[0].assetName.slice(STATE_QUEUE_BLOCK_PREFIX.length);
  if (!HEADER_HASH_HEX.test(suffix)) {
    return {
      ok: false,
      reason: `the token name suffix is not a 28-byte header hash: ${suffix}`,
    };
  }
  return { ok: true, headerHash: suffix };
}

/**
 * The policy the block tokens are issued under, from the deployment manifest.
 *
 * A minting policy id is the script hash, so this is the `stateQueue` family's
 * Mint entry. Read from the manifest rather than written down here: a constant
 * would survive a redeployment that changed every script hash, and would then
 * quietly match nothing.
 */
export function stateQueuePolicyId(entries: ReadonlyArray<ValidatorEntry>): string | null {
  const mint = entries.find(
    (entry) => entry.family === "stateQueue" && entry.purpose === "Mint" && !entry.placeholder,
  );
  return mint?.policyId ?? null;
}
