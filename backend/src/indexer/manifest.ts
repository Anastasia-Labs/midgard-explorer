import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { logger } from "../logger";
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

/** Schema versions this indexer knows how to read. A version outside this set
 * is refused rather than read on a guess: an unknown layout that happens to
 * carry a `contracts` key would otherwise index silently against fields that
 * moved. */
const SUPPORTED_SCHEMA_VERSIONS = new Set(["midgard-deployment-manifest-v2"]);

/**
 * Compiled scripts reviewed and recorded as unimplemented placeholders.
 *
 * Keyed by the compiled script, not by its hash. Stub status used to be
 * inferred from one hash appearing under more than one contract family, which
 * is a naming coincidence rather than a property of the script: it excluded
 * `reserveWithdraw` because two `fraudProof` entries happened to compile to the
 * same placeholder, and it would equally have missed a placeholder used by only
 * one family. Keying on the script also survives a redeployment, because the
 * bytes are stable while every script hash in the manifest is not.
 *
 * Both entries below are Aiken's trivial validators. Seventeen and eighteen
 * bytes cannot read a script context, so neither can enforce anything; the
 * address derived from such a hash is shared with any other deployment that
 * compiled the same placeholder, so indexing one reports unrelated preprod
 * traffic as Midgard activity.
 */
const PLACEHOLDER_SCRIPTS: ReadonlyMap<string, string> = new Map([
  [
    "5001010023259800b452689b2b20025735",
    "17-byte trivial PlutusV3 script; in the 2026-07-15 preprod deployment it " +
      "backs fraudProofCatalogueSpend, fraudProofSpend and reserveWithdraw",
  ],
  [
    "5101010023259800a518a4d136564004ae69",
    "18-byte trivial PlutusV3 script; in the 2026-07-15 preprod deployment it " +
      "backs escapeHatchSpend, escapeHatchMint, fraudProofNonExistentInputNoIndex " +
      "and fraudProofInvalidRange",
  ],
]);

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
  /** A reviewed placeholder rather than a deployed validator. Kept in the
   * manifest so a reader can see the contract exists and is not implemented,
   * and kept out of every scan. */
  placeholder: boolean;
};

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
    referenceScriptDeployAddress: z.string().min(1).optional(),
    hubOracleOneShot: z
      .object({
        txHash: z.string(),
        outputIndex: z.number(),
        outRef: z.string(),
      })
      .loose()
      .optional(),
    contracts: z.record(
      z.string(),
      z
        .object({
          scriptHash: z.string().optional(),
          // The compiled script. Required of a v2 manifest, because it is part
          // of what the deployment identity is computed over and it is the only
          // way to tell a placeholder from a validator.
          contract: z.object({ cborHex: z.string().min(1) }).loose().optional(),
        })
        .loose(),
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

/**
 * Key-sorted JSON, so one document has exactly one serialization.
 *
 * Ported from the deployment tooling that writes `manifestId`, and verified
 * against the deployed manifest by `manifest-identity.test.mts`: the two must
 * agree byte for byte or the recomputed identity is meaningless.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
    .join(",")}}`;
}

/** The subset of a v2 manifest the identity is computed over. `createdAt` and
 * `updatedAt` are deliberately absent: rewriting the file must not change the
 * identity of the deployment it describes. */
function identityInput(doc: Record<string, unknown>): unknown {
  const oneShot = (doc.hubOracleOneShot ?? {}) as Record<string, unknown>;
  const authPolicy = (doc.referenceScriptAuthPolicy ?? {}) as Record<string, unknown>;
  const contracts = (doc.contracts ?? {}) as Record<string, Record<string, unknown>>;
  return {
    schemaVersion: doc.schemaVersion,
    network: doc.network,
    referenceScriptDeployAddress: doc.referenceScriptDeployAddress,
    hubOracleOneShot: {
      txHash: oneShot.txHash,
      outputIndex: oneShot.outputIndex,
      outRef: oneShot.outRef,
    },
    referenceScriptAuthPolicy: {
      policyId: authPolicy.policyId,
      nativeScript: authPolicy.nativeScript,
      tokenNames: authPolicy.tokenNames,
    },
    contracts: Object.fromEntries(
      Object.entries(contracts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, entry]) => [
          name,
          { scriptHash: entry.scriptHash, contract: entry.contract },
        ]),
    ),
  };
}

/**
 * Recomputes a v2 deployment identity from the document itself.
 *
 * Computed from the raw parsed JSON rather than the decoded document, so what
 * is hashed is exactly what the file says.
 */
export function computeDeploymentId(raw: unknown): string {
  return createHash("sha256")
    .update(stableJson(identityInput(raw as Record<string, unknown>)))
    .digest("hex");
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
  /**
   * Every entry the manifest declares that has a script hash, with the purpose
   * its name states and whether it is a reviewed placeholder. Nothing is
   * dropped, so a count taken here matches a count taken from the file.
   */
  entries: ValidatorEntry[];
  /**
   * One entry per deployed contract, deduplicated by script hash.
   *
   * This is the read path's view: what the API lists and what an output address
   * is attributed to. A contract with both a spend and a mint purpose is one
   * contract and appears once.
   */
  validators: ValidatorEntry[];
  /**
   * What the indexer scans, deduplicated by purpose AND script hash.
   *
   * A contract with both a spend and a mint purpose needs both an address scan
   * and a policy scan; deduplicating by hash alone dropped the second purpose
   * and with it every mint the contract ever issued.
   */
  scanTargets: ValidatorEntry[];
  placeholderHashes: Set<string>;
  referenceScriptAuthPolicy: string | null;
};

/**
 * Splits the declared contracts into deployed validators and reviewed
 * placeholders.
 *
 * A placeholder is recognised by its compiled script. Where a script hash spans
 * more than one contract family and the script behind it is not a recorded
 * placeholder, this throws rather than guessing: silently indexing it reports
 * other deployments' traffic as Midgard, and silently excluding it drops a real
 * validator, so the only safe answer is to stop and have the script reviewed.
 */
function classifyPlaceholders(
  path: string,
  contracts: Record<string, { scriptHash?: string; contract?: { cborHex: string } }>,
): Set<string> {
  const familiesByHash = new Map<string, Set<string>>();
  const scriptsByHash = new Map<string, string | undefined>();
  for (const [name, entry] of Object.entries(contracts)) {
    if (!entry.scriptHash) continue;
    const families = familiesByHash.get(entry.scriptHash) ?? new Set<string>();
    families.add(contractFamily(name));
    familiesByHash.set(entry.scriptHash, families);
    scriptsByHash.set(entry.scriptHash, entry.contract?.cborHex);
  }

  const placeholders = new Set<string>();
  for (const [hash, families] of familiesByHash) {
    const cborHex = scriptsByHash.get(hash);
    if (cborHex !== undefined && PLACEHOLDER_SCRIPTS.has(cborHex)) {
      placeholders.add(hash);
      continue;
    }
    if (families.size === 1) continue;

    const shared = Object.entries(contracts)
      .filter(([, entry]) => entry.scriptHash === hash)
      .map(([name]) => name)
      .join(", ");
    if (cborHex === undefined) {
      // A manifest with no compiled scripts cannot be checked, so the older,
      // weaker signal is all there is. Excluding is the conservative side of
      // the trade: a missing validator shows as absent, an unrelated address
      // shows as Midgard activity that never happened.
      logger.warn(
        `Manifest at ${path} shares script hash ${hash} across families ` +
          `(${shared}) and carries no compiled script to check it against. ` +
          `Treating it as a placeholder and excluding it from every scan.`,
      );
      placeholders.add(hash);
      continue;
    }
    throw new Error(
      `Manifest at ${path} shares script hash ${hash} across contract ` +
        `families (${shared}), but its compiled script is not a recorded ` +
        `placeholder. Review the script and either record it in ` +
        `PLACEHOLDER_SCRIPTS or correct the manifest.`,
    );
  }
  return placeholders;
}

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
    deploymentId = verifiedV2DeploymentId(path, doc, raw);
  } else {
    deploymentId = legacyDeploymentId(network, doc.contracts);
  }

  const placeholderHashes = classifyPlaceholders(path, doc.contracts);

  const entries: ValidatorEntry[] = [];
  for (const [name, entry] of Object.entries(doc.contracts)) {
    if (entry.scriptHash === undefined) continue;
    if (!SCRIPT_HASH.test(entry.scriptHash)) {
      throw new Error(
        `Manifest at ${path} has a malformed scriptHash for ${name}: ` +
          `${entry.scriptHash}`,
      );
    }
    const purpose = contractPurpose(name);
    entries.push({
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
      placeholder: placeholderHashes.has(entry.scriptHash),
    });
  }

  const deployed = entries.filter((entry) => !entry.placeholder);
  const validators = dedupe(deployed, (entry) => entry.scriptHash);
  const scanTargets = dedupe(
    deployed,
    (entry) => `${entry.purpose}:${entry.scriptHash}`,
  );

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
    entries,
    validators,
    scanTargets,
    placeholderHashes,
    referenceScriptAuthPolicy,
  };
}

function dedupe(
  entries: ValidatorEntry[],
  key: (entry: ValidatorEntry) => string,
): ValidatorEntry[] {
  const seen = new Set<string>();
  const out: ValidatorEntry[] = [];
  for (const entry of entries) {
    const k = key(entry);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(entry);
  }
  return out;
}

/**
 * The declared identity of a v2 manifest, checked against the document.
 *
 * A well-formed identity used to be accepted on its shape alone, which proves
 * only that someone typed 64 hex characters. A contract set edited after
 * deployment then kept the legitimate identity, and every row indexed from it
 * was attributed to a deployment that does not describe those scripts.
 * Recomputing is what makes the identity mean something.
 */
function verifiedV2DeploymentId(
  path: string,
  doc: ManifestDocument,
  raw: unknown,
): string {
  if (doc.manifestId === undefined) {
    throw new Error(
      `Manifest at ${path} declares schemaVersion "${doc.schemaVersion}" but ` +
        `has no manifestId. A versioned manifest must state the deployment ` +
        `identity its rows are attributed to.`,
    );
  }
  if (!DEPLOYMENT_ID.test(doc.manifestId)) {
    throw new Error(
      `Manifest at ${path} has a manifestId that is not 64 lowercase hex ` +
        `characters: ${doc.manifestId}`,
    );
  }

  // Every field below is hashed into the identity. One that is absent silently
  // hashes as null, which would let a document opt out of verification by
  // leaving it out.
  const required: Array<[string, unknown]> = [
    ["referenceScriptDeployAddress", doc.referenceScriptDeployAddress],
    ["hubOracleOneShot", doc.hubOracleOneShot],
    ["referenceScriptAuthPolicy", doc.referenceScriptAuthPolicy],
  ];
  const absent = required.filter(([, value]) => value === undefined || value === null);
  if (absent.length > 0) {
    throw new Error(
      `Manifest at ${path} declares schemaVersion "${doc.schemaVersion}" but ` +
        `is missing ${absent.map(([name]) => name).join(", ")}, which the ` +
        `deployment identity is computed over.`,
    );
  }
  for (const [name, entry] of Object.entries(doc.contracts)) {
    if (entry.contract === undefined) {
      throw new Error(
        `Manifest at ${path} has no compiled script for ${name}. A versioned ` +
          `manifest carries every script it names, both because the identity ` +
          `is computed over them and because a placeholder cannot be told ` +
          `from a validator without one.`,
      );
    }
  }

  const recomputed = computeDeploymentId(raw);
  if (recomputed !== doc.manifestId) {
    throw new Error(
      `Manifest at ${path} declares manifestId ${doc.manifestId} but its ` +
        `contents hash to ${recomputed}. The document has been modified since ` +
        `it was written, so rows indexed from it would be attributed to a ` +
        `deployment that does not describe these scripts.`,
    );
  }
  return doc.manifestId;
}
