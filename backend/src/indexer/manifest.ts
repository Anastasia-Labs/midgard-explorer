import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { scriptHashToAddress, scriptHashToRewardAddress } from "./bech32";

/**
 * The purposes a manifest entry name can declare.
 *
 * "Observer" was listed here and matches nothing. The deployed manifest carries
 * 17 Spend, 17 Mint, 2 Withdraw and 4 unsuffixed entries and not one Observer,
 * so the suffix only ever mis-derived a family for a name that happened to end
 * in it. It is not reinstated without an entry that proves what it means.
 */
const PURPOSE_SUFFIXES = ["Spend", "Mint", "Withdraw"] as const;

export type Purpose = (typeof PURPOSE_SUFFIXES)[number] | "None";

/** Which scan can see this entry's executions.
 *
 * A Spend entry is found by address history. A Mint entry is found by the
 * assets issued under its policy, which is the script hash itself. A Withdraw
 * entry is found by its reward account. These are not interchangeable: a
 * withdraw-only validator ignores the transaction entirely, so no rule could
 * make its execution touch a payment address. */
export function contractPurpose(entryName: string): Purpose {
  for (const suffix of PURPOSE_SUFFIXES) {
    if (entryName.endsWith(suffix) && entryName.length > suffix.length) {
      return suffix;
    }
  }
  return "None";
}

/** Schema versions this indexer knows how to read. A version outside this set
 * is refused rather than read on a guess: an unknown layout that happens to
 * carry a `contracts` key would otherwise index silently against fields that
 * moved. */
const SUPPORTED_SCHEMA_VERSIONS = new Set(["midgard-deployment-manifest-v2"]);

export type ValidatorEntry = {
  entryName: string;
  family: string;
  purpose: Purpose;
  scriptHash: string;
  /** Enterprise payment address. Only a Spend entry is reachable through it. */
  address: string;
  /** Reward address for the same hash. Set for a Withdraw entry, which is
   * executed against this and never against `address`. */
  rewardAddress: string | null;
  /** Minting policy id, which for a minting script is the script hash. Set for
   * a Mint entry, whose executions are found through the assets it issues. */
  policyId: string | null;
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

const SCRIPT_HASH = /^[0-9a-f]{56}$/;
const DEPLOYMENT_ID = /^[0-9a-f]{64}$/;

/** The document as it sits on disk. Every field the indexer reads is declared
 * here and nowhere else, so there is one decode boundary rather than a mix of
 * `typeof` guards and property access on `any`.
 *
 * Unknown keys are kept rather than stripped: the manifest is written by the
 * deployment tooling and carries more than this reader needs (`steps`,
 * `referenceScripts`, `hubOracleOneShot`). Rejecting those would couple the
 * explorer to a field list it has no stake in. */
const ManifestDocument = z
  .object({
    schemaVersion: z.string().min(1).optional(),
    network: z.string().min(1),
    createdAt: z.string().min(1),
    manifestId: z.string().optional(),
    contracts: z.record(
      z.string(),
      z.object({ scriptHash: z.string().optional() }).loose(),
    ),
    referenceScriptAuthPolicy: z
      .object({ policyId: z.string() })
      .loose()
      .nullish(),
  })
  .loose();

export type ManifestDocument = z.infer<typeof ManifestDocument>;

/**
 * The identity every indexed row is attributed to, for a manifest that predates
 * `manifestId`.
 *
 * Derived rather than defaulted. A shared constant such as "default" makes two
 * different deployments indistinguishable in the same table, which is the
 * failure this identity exists to prevent. Hashing the contract set gives a
 * value that is stable across restarts, different for any deployment whose
 * scripts differ, and different across networks.
 */
export function legacyDeploymentId(
  network: string,
  contracts: Record<string, { scriptHash?: string }>,
): string {
  const canonical = Object.entries(contracts)
    .filter(([, entry]) => typeof entry.scriptHash === "string")
    .map(([name, entry]) => `${name}=${entry.scriptHash}`)
    .sort()
    .join("\n");
  const digest = createHash("sha256")
    .update(`${network}\n${canonical}`)
    .digest("hex");
  return `legacy-${digest}`;
}

/** One parsed manifest per path, keyed by the file's modification time.
 *
 * This is read on request paths, not only by the sync loop: the withdrawals
 * listing needs the network to encode an address, and the L1 handlers need the
 * script-hash-to-validator map. Reading, parsing, validating and deriving a
 * bech32 address per validator on every request is work the request did not
 * need to do, on a thread that cannot do anything else while it happens.
 *
 * Keying on mtime rather than caching forever means an operator who replaces a
 * manifest sees the new deployment without restarting the process. Failures are
 * not cached: a manifest that could not be read has to keep saying so. */
const parsed = new Map<string, { mtimeMs: number; manifest: Manifest }>();

export function loadManifest(path: string): Manifest {
  const mtimeMs = statSync(path).mtimeMs;
  const hit = parsed.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.manifest;

  const manifest = parseManifest(path);
  parsed.set(path, { mtimeMs, manifest });
  return manifest;
}

export type Manifest = {
  /** Absent on a pre-`manifestId` manifest, which is what makes it legacy. */
  schemaVersion: string | null;
  network: "preprod" | "mainnet";
  /** The canonical identity every indexed row is attributed to. Never a shared
   * constant, so two deployments can never merge in one table. */
  deploymentId: string;
  createdAt: string;
  validators: ValidatorEntry[];
  stubHashes: Set<string>;
  referenceScriptAuthPolicy: string | null;
};

/** Reads and validates the manifest, or throws naming the field at fault.
 *
 * Every check here runs before the indexer or the server is allowed to use the
 * document, because each one of them silently degraded something downstream:
 * an absent `createdAt` reached the UI as the string "undefined" and threw when
 * it was formatted, and a missing deployment identity let every row land under
 * one shared value that no query could tell apart. */
export function parseManifest(path: string): Manifest {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));

  const result = ManifestDocument.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Manifest at ${path} is not a valid document. ${detail}`);
  }
  const doc = result.data;

  if (
    doc.schemaVersion !== undefined &&
    !SUPPORTED_SCHEMA_VERSIONS.has(doc.schemaVersion)
  ) {
    throw new Error(
      `Manifest at ${path} declares unsupported schemaVersion ` +
        `"${doc.schemaVersion}". Supported: ` +
        `${[...SUPPORTED_SCHEMA_VERSIONS].join(", ")}`,
    );
  }

  const networkStr = doc.network.toLowerCase();
  if (networkStr !== "mainnet" && networkStr !== "preprod") {
    throw new Error(
      `Manifest at ${path} has unrecognized network value: ${doc.network}`,
    );
  }
  const network: "preprod" | "mainnet" = networkStr;

  if (Number.isNaN(new Date(doc.createdAt).getTime())) {
    throw new Error(
      `Manifest at ${path} has an unparseable createdAt: ${doc.createdAt}`,
    );
  }

  // A versioned manifest states its own identity and is refused without one.
  // Deriving a substitute here would hide a deployment tool that stopped
  // writing the field, and the derived value would then disagree with every
  // row already attributed to the declared identity.
  let deploymentId: string;
  if (doc.schemaVersion !== undefined) {
    if (doc.manifestId === undefined) {
      throw new Error(
        `Manifest at ${path} declares schemaVersion ` +
          `"${doc.schemaVersion}" but has no manifestId. A versioned manifest ` +
          `must state the deployment identity its rows are attributed to.`,
      );
    }
    if (!DEPLOYMENT_ID.test(doc.manifestId)) {
      throw new Error(
        `Manifest at ${path} has a manifestId that is not 64 lowercase hex ` +
          `characters: ${doc.manifestId}`,
      );
    }
    deploymentId = doc.manifestId;
  } else {
    deploymentId = legacyDeploymentId(network, doc.contracts);
  }

  const stubHashes = findStubHashes(doc.contracts);

  const seen = new Set<string>();
  const validators: ValidatorEntry[] = [];
  for (const [name, entry] of Object.entries(doc.contracts)) {
    if (entry.scriptHash === undefined) continue;
    if (!SCRIPT_HASH.test(entry.scriptHash)) {
      throw new Error(
        `Manifest at ${path} has a malformed scriptHash for ${name}: ` +
          `${entry.scriptHash}`,
      );
    }
    if (stubHashes.has(entry.scriptHash)) continue;
    if (seen.has(entry.scriptHash)) continue;
    seen.add(entry.scriptHash);
    const purpose = contractPurpose(name);
    validators.push({
      entryName: name,
      family: contractFamily(name),
      purpose,
      scriptHash: entry.scriptHash,
      address: scriptHashToAddress(entry.scriptHash, network),
      rewardAddress:
        purpose === "Withdraw"
          ? scriptHashToRewardAddress(entry.scriptHash, network)
          : null,
      policyId: purpose === "Mint" ? entry.scriptHash : null,
    });
  }

  // Reference scripts are published to the DEPLOYER'S OWN WALLET address, not
  // to a script address, so the transactions that put Midgard's contracts on
  // chain are invisible to an address scan over validators. Each carries a
  // token under this policy, which is how they can be found at all.
  const referenceScriptAuthPolicy =
    doc.referenceScriptAuthPolicy?.policyId ?? null;

  return {
    schemaVersion: doc.schemaVersion ?? null,
    network,
    deploymentId,
    createdAt: doc.createdAt,
    validators,
    stubHashes,
    referenceScriptAuthPolicy,
  };
}
