import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { computeDeploymentManifestId } from "@al-ft/midgard-core/deployment-manifest-identity";
import { parseManifest, SUPPORTED_SCHEMA_VERSIONS } from "../src/db/manifest.js";

/**
 * A `midgard-deployment-manifest-v1` is checked by Midgard's own verifier.
 *
 * Its identity is a hash over the whole document, and the verifier also
 * checks the consensus profile, the deployment profile binding and economics
 * against the profile the vendored packages were built for. The explorer's
 * own identity hash covers a subset of fields, so it could neither recompute a
 * v1 id nor make any of those checks.
 *
 * Both manifests come from Midgard's own test helper, `finalizedManifest()`,
 * at the named commit with the `preprod-testing` profile.
 */

type Doc = Record<string, unknown> & { manifestId: string };
const fixture = (name: string): Doc =>
  JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).toString("utf8"));

const dir = mkdtempSync(join(tmpdir(), "manifest-v1-"));
let n = 0;
const onDisk = (doc: unknown): string => {
  const path = join(dir, `manifest-${(n += 1)}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
};
/** A changed document under a recomputed id, so only the change is at fault. */
const reidentified = (doc: Doc): Doc => {
  const { manifestId: _old, ...rest } = doc;
  return { ...rest, manifestId: computeDeploymentManifestId(rest) };
};

const pinned = fixture("manifest-v1-f4cf28ca1-preprod-testing.json.gz");

describe("a v1 manifest", () => {
  it("is accepted from the pinned commit, under its declared id", () => {
    const manifest = parseManifest(onDisk(pinned));
    expect(manifest.schemaVersion).toBe("midgard-deployment-manifest-v1");
    expect(manifest.deploymentId).toBe(pinned.manifestId);
    expect(manifest.network).toBe("preprod");
    expect(manifest.validators.length).toBeGreaterThan(0);
  });

  it("states the deployment's block maturity, which the queue view counts from", () => {
    // 900000 ms on preprod-testing: fifteen minutes from commit to maturity.
    expect(parseManifest(onDisk(pinned)).blockMaturityMs).toBe(900_000);
  });

  it("is refused when its content no longer hashes to its id", () => {
    const doc = structuredClone(pinned) as Doc & { createdAt: string };
    doc.createdAt = "2026-07-25T00:00:00.000Z";
    expect(() => parseManifest(onDisk(doc))).toThrow(/manifest id mismatch/);
  });

  it("is refused when its economics differ from the deployment profile", () => {
    const doc = structuredClone(pinned) as Doc & { economics: Record<string, unknown> };
    const [key] = Object.keys(doc.economics);
    doc.economics[key!] = typeof doc.economics[key!] === "string" ? "1" : 1;
    expect(() => parseManifest(onDisk(reidentified(doc)))).toThrow(/economics/i);
  });

  it("is refused when it is bound to another deployment profile", () => {
    const doc = structuredClone(pinned) as Doc & { deploymentProfileDigest: string };
    doc.deploymentProfileDigest = "00".repeat(32);
    expect(() => parseManifest(onDisk(reidentified(doc)))).toThrow(
      /Deployment profile, digest, and network must match/,
    );
  });

  /** Every script hash is checked against its compiled script, so a hash is
   * never taken on the manifest's word. */
  it("is refused when a contract's script no longer matches its hash", () => {
    const doc = structuredClone(pinned) as Doc & {
      contracts: Record<string, { scriptHash: string; contract: { cborHex: string } }>;
    };
    // A valid script from another contract, under this contract's hash.
    const contracts = Object.values(doc.contracts);
    const target = contracts.find((c) => c.contract.cborHex !== contracts[0]!.contract.cborHex);
    expect(target, "the fixture has two distinct scripts to swap").toBeDefined();
    target!.contract.cborHex = contracts[0]!.contract.cborHex;
    expect(() => parseManifest(onDisk(reidentified(doc)))).toThrow(/scriptHash mismatch/);
  });

  /** A v1 catalogue reuses one compiled validator under more than one name:
   * the live Preprod manifest shares 14 hashes between families, such as two
   * fraud-proof steps with the same logic. With every hash checked against its
   * script, a shared hash is the same script, and only a recorded placeholder
   * script is excluded. */
  it("lists a validator two contract families share once", () => {
    const manifest = parseManifest(onDisk(pinned));
    const hashes = manifest.validators.map((v) => v.scriptHash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(manifest.placeholderHashes.size).toBe(0);
  });

  /** b9511834c raised `limits.maxCekBuiltinTag` from 86 to 100. A deployment
   * made under that consensus profile is not one this build can read, and the
   * verifier says so rather than the explorer reading it on a guess. */
  it("is refused from b9511834c, whose consensus profile differs", () => {
    const later = fixture("manifest-v1-b9511834c-preprod-testing.json.gz");
    expect(() => parseManifest(onDisk(later))).toThrow(/consensusProfile/);
  });
});

describe("a v2 manifest", () => {
  it("is still read", () => {
    const path = new URL("./fixtures/manifest-sample.json", import.meta.url).pathname;
    expect(parseManifest(path).schemaVersion).toBe("midgard-deployment-manifest-v2");
  });
});

describe("the compatibility pin", () => {
  /** `pnpm doctor` checks a deployment's manifest against this list, and
   * `compat write` never writes it, so nothing else keeps it current. */
  it("lists every manifest schema the backend reads", () => {
    const pin = JSON.parse(
      readFileSync(new URL("../../config/midgard-compatibility.json", import.meta.url), "utf8"),
    ) as { manifestSchemaVersions: string[] };
    expect([...pin.manifestSchemaVersions].sort()).toEqual([...SUPPORTED_SCHEMA_VERSIONS].sort());
  });
});
