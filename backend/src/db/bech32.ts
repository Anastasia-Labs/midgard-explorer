import {
  credentialToAddress,
  credentialToRewardAddress,
  scriptHashToCredential,
} from "@lucid-evolution/lucid";
import { CANONICAL_HASH28 } from "../utils";

/**
 * Script hash to address, via Lucid.
 *
 * This was ninety-five lines of hand-rolled bech32: the polymod, the HRP
 * expansion, the 8-to-5 bit conversion and the charset, written out here. The
 * comment above it justified that by saying Lucid was a devDependency and
 * should not reach the server's runtime path. That stopped being true: Lucid is
 * a runtime dependency and `decode/datum.ts` and `decode/withdrawal.ts` already
 * import it, so the reason to keep a second implementation had gone while the
 * implementation stayed.
 *
 * It is worth removing rather than merely shorter. An address derivation is the
 * difference between indexing Midgard's contracts and indexing somebody else's,
 * and a checksum written by hand is a checksum only one project has ever
 * tested. `bech32-parity.test.mts` proves the two agreed on every entry of the
 * deployed manifest on both networks before this replaced it, and stays as a
 * gate against the derivation changing under us.
 */

/** Lucid names networks with a capital; the manifest uses lowercase. */
const NETWORK = { preprod: "Preprod", mainnet: "Mainnet" } as const;

export type Network = keyof typeof NETWORK;

/**
 * The width check the hand-rolled encoder carried, kept.
 *
 * Lucid does not reject a short hash: it derives an address from whatever it is
 * given. The replacement therefore had to restore this explicitly, and the
 * existing suite is what caught its absence. A malformed hash silently yielding
 * a well-formed address is the worst shape this failure can take, because the
 * indexer would then scan an address no contract lives at and report the
 * protocol as having no activity.
 */
function assertScriptHash(scriptHash: string): string {
  if (!CANONICAL_HASH28.test(scriptHash)) {
    throw new Error(
      `Script hash must be 28 bytes of lowercase hex, got: ${scriptHash}`,
    );
  }
  return scriptHash;
}

/** The enterprise address a spend validator is reachable at. */
export const scriptHashToAddress = (scriptHash: string, network: Network): string =>
  credentialToAddress(NETWORK[network], scriptHashToCredential(assertScriptHash(scriptHash)));

/** The reward account a withdraw validator is executed against. Not
 * interchangeable with the address above: a withdraw-only validator ignores the
 * payment side entirely, so no address scan can ever see its executions. */
export const scriptHashToRewardAddress = (scriptHash: string, network: Network): string =>
  credentialToRewardAddress(NETWORK[network], scriptHashToCredential(assertScriptHash(scriptHash)));
