import {
  credentialToAddress,
  credentialToRewardAddress,
  scriptHashToCredential,
} from "@lucid-evolution/utils";
import { CANONICAL_HASH28 } from "../utils";

/** Lucid names networks with a capital; the manifest uses lowercase. */
const NETWORK = { preprod: "Preprod", mainnet: "Mainnet" } as const;

export type Network = keyof typeof NETWORK;

/** Lucid accepts short hashes, so validate the protocol width first. */
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
