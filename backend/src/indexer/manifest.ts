import { readFileSync } from "node:fs";
import { scriptHashToAddress } from "./bech32";

const PURPOSE_SUFFIXES = ["Spend", "Mint", "Withdraw", "Observer"];

export type ValidatorEntry = {
  entryName: string;
  family: string;
  scriptHash: string;
  address: string;
};

/** "daParamsGovernorSpend" and "daParamsGovernorMint" are one contract, two
 * purposes. Stripping the purpose gives the family both share. */
export function contractFamily(entryName: string): string {
  for (const suffix of PURPOSE_SUFFIXES) {
    if (entryName.endsWith(suffix) && entryName.length > suffix.length) {
      return entryName.slice(0, -suffix.length);
    }
  }
  return entryName;
}

/**
 * A hash used by more than one contract family is an unimplemented placeholder,
 * not a real validator: several stubs compile to the same trivial script. Its
 * address is shared with unrelated preprod traffic, so indexing it would report
 * other people's transactions as Midgard activity.
 */
export function findStubHashes(
  contracts: Record<string, { scriptHash?: string }>,
): Set<string> {
  const familiesByHash = new Map<string, Set<string>>();
  for (const [name, entry] of Object.entries(contracts)) {
    if (!entry.scriptHash) continue;
    const set = familiesByHash.get(entry.scriptHash) ?? new Set<string>();
    set.add(contractFamily(name));
    familiesByHash.set(entry.scriptHash, set);
  }
  const stubs = new Set<string>();
  for (const [hash, families] of familiesByHash) {
    if (families.size > 1) stubs.add(hash);
  }
  return stubs;
}

export function loadManifest(path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8"));

  if (!raw.contracts) {
    throw new Error(`Manifest at ${path} has no contracts key`);
  }

  const networkStr = String(raw.network).toLowerCase();
  if (networkStr !== "mainnet" && networkStr !== "preprod") {
    throw new Error(
      `Manifest at ${path} has unrecognized network value: ${raw.network}`,
    );
  }
  const network: "preprod" | "mainnet" = networkStr as "preprod" | "mainnet";

  const contracts: Record<string, { scriptHash?: string }> = raw.contracts;
  const stubHashes = findStubHashes(contracts);

  const seen = new Set<string>();
  const validators: ValidatorEntry[] = [];
  for (const [name, entry] of Object.entries(contracts)) {
    if (!entry.scriptHash) continue;
    if (stubHashes.has(entry.scriptHash)) continue;
    if (seen.has(entry.scriptHash)) continue;
    seen.add(entry.scriptHash);
    const family = contractFamily(name);
    validators.push({
      entryName: name,
      family,
      scriptHash: entry.scriptHash,
      address: scriptHashToAddress(entry.scriptHash, network),
    });
  }

  // Reference scripts are published to the DEPLOYER'S OWN WALLET address, not
  // to a script address, so the transactions that put Midgard's contracts on
  // chain are invisible to an address scan over validators. Each carries a
  // token under this policy, which is how they can be found at all.
  const referenceScriptAuthPolicy: string | null =
    typeof raw.referenceScriptAuthPolicy?.policyId === "string"
      ? raw.referenceScriptAuthPolicy.policyId
      : null;

  // The deployment's own identity. With multiple manifests deferred, this is
  // what tells a viewer which deployment the figures on the page describe.
  const manifestId =
    typeof raw.manifestId === "string" ? raw.manifestId : null;

  return {
    network,
    manifestId,
    createdAt: String(raw.createdAt),
    validators,
    stubHashes,
    referenceScriptAuthPolicy,
  };
}
