import { config } from "../config";
import { loadManifest, type ValidatorEntry } from "./manifest";

/**
 * The contracts this deployment declares on Cardano.
 *
 * Everything here comes from the deployment manifest, which is configuration:
 * a file this process reads. It says which validators the deployment uses and
 * where they live, and it says nothing about what has happened on Cardano. That
 * distinction is the whole content of this module, and every surface built on
 * it has to keep it: a validator listed here has an address, not a history.
 *
 * This file used to hold the read path for the explorer-owned chain index, which
 * answered the second question. The index is decommissioned; what the node
 * itself recorded about Cardano is in `cardanoActivity.ts`.
 */

export type ValidatorIdentity = {
  family: string;
  purpose: string;
  scriptHash: string;
  address: string;
  rewardAddress: string | null;
  policyId: string | null;
  /** A reviewed placeholder rather than a deployed validator. Carried so a
   * reader is not shown an address for a contract that was never deployed. */
  placeholder: boolean;
};

const toIdentity = (entry: ValidatorEntry): ValidatorIdentity => ({
  family: entry.family,
  purpose: entry.purpose,
  scriptHash: entry.scriptHash,
  address: entry.address,
  rewardAddress: entry.rewardAddress ?? null,
  policyId: entry.policyId ?? null,
  placeholder: entry.placeholder,
});

/** Every validator the manifest declares. Throws when the manifest cannot be
 * read, which is a configuration failure and not an empty result. */
export function getManifestValidators(): ValidatorEntry[] {
  return loadManifest(config.MIDGARD_MANIFEST_PATH).validators;
}

export function listValidators(): {
  deploymentId: string;
  network: string;
  validators: ValidatorIdentity[];
} {
  const manifest = loadManifest(config.MIDGARD_MANIFEST_PATH);
  return {
    deploymentId: manifest.deploymentId,
    network: manifest.network,
    validators: manifest.validators.map(toIdentity),
  };
}

/**
 * One validator, by script hash.
 *
 * Null rather than a constructed answer when the hash is not in the manifest.
 * An explorer that described any script hash a visitor typed would be inventing
 * a Midgard contract out of an arbitrary input.
 */
export function getValidator(scriptHash: string): {
  deploymentId: string;
  network: string;
  validator: ValidatorIdentity;
} | null {
  const manifest = loadManifest(config.MIDGARD_MANIFEST_PATH);
  const entry = manifest.validators.find((row) => row.scriptHash === scriptHash);
  return entry === undefined
    ? null
    : {
        deploymentId: manifest.deploymentId,
        network: manifest.network,
        validator: toIdentity(entry),
      };
}
