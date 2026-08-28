import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeDeploymentId,
  contractFamily,
  loadManifest,
} from "../src/indexer/manifest.js";

const FIXTURE = new URL(
  "./fixtures/manifest-sample.json",
  import.meta.url,
).pathname;

const V2 = "midgard-deployment-manifest-v2";

/** A manifest with no `schemaVersion`, which is what makes it legacy. Each case
 * below overrides exactly the field it is about, so a failure names that field
 * rather than the first missing one. */
const LEGACY = {
  network: "Preprod",
  createdAt: "2026-07-15T17:25:29.000Z",
  contracts: {
    stateQueueSpend: { scriptHash: "a".repeat(56) },
    depositSpend: { scriptHash: "b".repeat(56) },
  },
};

/** Writes a manifest to its own path and returns the identity it resolves to.
 * A fresh path per case keeps the mtime cache from answering with an earlier
 * document. */
function write(name: string, body: unknown): string {
  const path = join(tmpdir(), `midgard-manifest-${name}-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(body));
  return loadManifest(path).deploymentId;
}

/** Loads a modified copy of the fixture.
 *
 * `resign` restamps the manifestId over the modified contents. Identity
 * verification runs before anything else reads the document, so a case about
 * some later rule has to hand it a document that is internally consistent
 * first, or it only ever observes the identity check firing. */
function loadModified(
  name: string,
  mutate: (doc: any) => void,
  resign = false,
) {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  mutate(doc);
  if (resign) doc.manifestId = computeDeploymentId(doc);
  const path = join(tmpdir(), `midgard-manifest-${name}-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return () => loadManifest(path);
}

const ESCAPE_HATCH = "bd3ae991b5aafccafe5ca70758bd36a9b2f872f57f6d3a1ffa0eb777";
const FRAUD_CATALOGUE = "22c9a103ed3f2fa97c982d76d6e2af50c5d54ac306983b196c8fcdab";
const DA_PARAMS = "008c416cdcfe3081a32202a605b777e3790947cdd00900cf72343958";
const DA_ATTESTATION = "65976139558770f54efbe6a16cc2ae078007e347c2bff6e8e9f3a948";

/** The 17-byte always-succeed script behind fraudProofSpend and reserveWithdraw. */
const TRIVIAL_SCRIPT = "5001010023259800b452689b2b20025735";

describe("contractFamily", () => {
  it("strips purpose suffixes", () => {
    expect(contractFamily("daParamsGovernorSpend")).toBe("daParamsGovernor");
    expect(contractFamily("daParamsGovernorMint")).toBe("daParamsGovernor");
    expect(contractFamily("reserveWithdraw")).toBe("reserve");
    // "Observer" is deliberately not a purpose: the deployed manifest has no
    // such entry, so the suffix only ever mis-derived a family for a name
    // that happened to end in it.
    expect(contractFamily("reserveObserver")).toBe("reserveObserver");
  });

  it("leaves a name with no purpose suffix alone", () => {
    expect(contractFamily("fraudProofInvalidRange")).toBe(
      "fraudProofInvalidRange",
    );
  });
});

/**
 * Placeholder classification, which decides what is scanned.
 *
 * This used to read "a hash under more than one contract family is a stub",
 * which is a property of the NAMES rather than of the script. It excluded
 * `reserveWithdraw` because two unimplemented `fraudProof` entries happened to
 * compile to the same trivial script, and it would have missed a placeholder
 * used by a single family. It is now decided by the compiled script.
 */
describe("placeholder classification", () => {
  const m = loadManifest(FIXTURE);

  it("flags the hashes whose script is a recorded placeholder", () => {
    expect(m.placeholderHashes.has(ESCAPE_HATCH)).toBe(true);
    expect(m.placeholderHashes.has(FRAUD_CATALOGUE)).toBe(true);
    expect(m.placeholderHashes.size).toBe(2);
  });

  it("does not flag a real contract that has both a spend and a mint purpose", () => {
    expect(m.placeholderHashes.has(DA_PARAMS)).toBe(false);
    expect(m.placeholderHashes.has(DA_ATTESTATION)).toBe(false);
  });

  it("flags a placeholder used by only one family, which hash sharing could not see", () => {
    const load = loadModified(
      "lone-placeholder",
      (doc) => {
        doc.contracts.stateQueueSpend.contract.cborHex = TRIVIAL_SCRIPT;
      },
      true,
    );
    const entry = load().entries.find((e) => e.entryName === "stateQueueSpend");
    expect(entry?.placeholder).toBe(true);
  });

  it("refuses a shared hash whose script is not a recorded placeholder", () => {
    // Silently indexing it reports another deployment's traffic as Midgard;
    // silently excluding it drops a real validator. Neither is acceptable
    // without a human deciding which it is.
    const load = loadModified(
      "unreviewed-shared",
      (doc) => {
        const real = doc.contracts.stateQueueSpend.contract.cborHex;
        for (const name of [
          "escapeHatchSpend",
          "escapeHatchMint",
          "fraudProofNonExistentInputNoIndex",
          "fraudProofInvalidRange",
        ]) {
          doc.contracts[name].contract.cborHex = real;
        }
      },
      true,
    );
    expect(load).toThrow(/not a recorded/);
  });
});

/**
 * What the manifest hands to each consumer.
 *
 * Three views rather than one. Deduplicating by script hash before purposes
 * were preserved dropped `daParamsGovernorMint` and `daAttestationMint`
 * outright, so those policies were never scanned and every asset they issued
 * was invisible. The read path still wants one row per contract, so the two
 * views are derived separately from the same complete entry list.
 */
describe("manifest views", () => {
  const m = loadManifest(FIXTURE);

  it("preserves every declared entry, including placeholders", () => {
    const declared = Object.keys(
      JSON.parse(readFileSync(FIXTURE, "utf8")).contracts,
    );
    expect(m.entries.map((e) => e.entryName).sort()).toEqual(declared.sort());
  });

  it("records the purpose of every entry, not only the ones it scans", () => {
    const byName = new Map(m.entries.map((e) => [e.entryName, e.purpose]));
    expect(byName.get("daParamsGovernorMint")).toBe("Mint");
    expect(byName.get("reserveWithdraw")).toBe("Withdraw");
    expect(byName.get("fraudProofInvalidRange")).toBe("None");
  });

  it("scans both purposes of a contract that compiles to one script", () => {
    const daParams = m.scanTargets.filter((v) => v.family === "daParamsGovernor");
    expect(daParams.map((v) => v.purpose).sort()).toEqual(["Mint", "Spend"]);
    // The mint purpose is what carries the policy to scan. Without it the
    // contract's mints are unreachable by any source.
    expect(daParams.find((v) => v.purpose === "Mint")?.policyId).toBe(DA_PARAMS);
  });

  it("gives the read path one row per contract", () => {
    const daParams = m.validators.filter((v) => v.family === "daParamsGovernor");
    expect(daParams.length).toBe(1);
    expect(new Set(m.validators.map((v) => v.scriptHash)).size).toBe(
      m.validators.length,
    );
  });

  it("keeps placeholders out of both scanning and the read path", () => {
    for (const view of [m.validators, m.scanTargets]) {
      const hashes = view.map((v) => v.scriptHash);
      expect(hashes).not.toContain(ESCAPE_HATCH);
      expect(hashes).not.toContain(FRAUD_CATALOGUE);
    }
    expect(m.entries.some((e) => e.scriptHash === FRAUD_CATALOGUE)).toBe(true);
  });

  it("keeps distinct contracts distinct", () => {
    const deposits = m.validators.filter((v) => v.family === "deposit");
    expect(deposits.length).toBe(2);
    expect(new Set(deposits.map((v) => v.address)).size).toBe(2);
  });

  it("gives every mint target a policy and every withdraw target a reward account", () => {
    for (const v of m.scanTargets) {
      if (v.purpose === "Mint") expect(v.policyId).toBe(v.scriptHash);
      if (v.purpose === "Withdraw") {
        expect(v.rewardAddress).toMatch(/^stake_test1|^stake1/);
      }
    }
  });

  it("derives a usable address for each validator", () => {
    for (const v of m.validators) {
      expect(v.address.startsWith("addr_test1w")).toBe(true);
    }
  });

  it("reads the network", () => {
    expect(m.network).toBe("preprod");
  });

  it("throws on missing contracts key", () => {
    const malformed = join(tmpdir(), "no-contracts.json");
    writeFileSync(malformed, JSON.stringify({ ...LEGACY, contracts: undefined }));
    expect(() => loadManifest(malformed)).toThrow(/not a valid document/);
    expect(() => loadManifest(malformed)).toThrow(/contracts/);
  });

  it("throws on unrecognized network value", () => {
    expect(() => write("bad-network", { ...LEGACY, network: "Mainnet2" })).toThrow(
      /unrecognized network value/,
    );
  });
});

/**
 * The identity every indexed row is attributed to.
 *
 * This was previously left to the `deployment` column default while the
 * validator query filtered on the manifest's declared id, so events were
 * written under one value and read under another and no query could return
 * them. Then the declared id was accepted on its SHAPE alone, which proves only
 * that someone typed 64 hex characters: a contract set edited after deployment
 * kept the legitimate identity. It is now recomputed from the document.
 */
describe("deployment identity", () => {
  it("accepts a versioned manifest whose contents hash to its declared id", () => {
    const m = loadManifest(FIXTURE);
    expect(m.deploymentId).toBe(
      JSON.parse(readFileSync(FIXTURE, "utf8")).manifestId,
    );
    expect(m.schemaVersion).toBe(V2);
  });

  it("refuses a manifest whose contracts were edited after it was written", () => {
    const load = loadModified("tampered-hash", (doc) => {
      doc.contracts.stateQueueSpend.scriptHash = "9".repeat(56);
    });
    expect(load).toThrow(/contents hash to/);
  });

  it("refuses a manifest whose compiled script was swapped", () => {
    const load = loadModified("tampered-script", (doc) => {
      doc.contracts.stateQueueSpend.contract.cborHex = TRIVIAL_SCRIPT;
    });
    expect(load).toThrow(/contents hash to/);
  });

  it("refuses a manifest that omits a field the identity is computed over", () => {
    // Without this, a document could opt out of verification by leaving the
    // field out: an absent value hashes as null rather than failing.
    for (const field of [
      "referenceScriptDeployAddress",
      "hubOracleOneShot",
      "referenceScriptAuthPolicy",
    ]) {
      const load = loadModified(`missing-${field}`, (doc) => {
        delete doc[field];
      });
      expect(load).toThrow(new RegExp(`missing ${field}`));
    }
  });

  it("refuses a versioned manifest that carries no compiled script", () => {
    const load = loadModified("no-script", (doc) => {
      delete doc.contracts.stateQueueSpend.contract;
    });
    expect(load).toThrow(/no compiled script for stateQueueSpend/);
  });

  it("refuses a versioned manifest that states no identity", () => {
    expect(() => write("v2-no-id", { ...LEGACY, schemaVersion: V2 })).toThrow(
      /no manifestId/,
    );
  });

  it("refuses a manifestId that is not 64 lowercase hex characters", () => {
    for (const bad of ["not-hex", "ABC", "a".repeat(63), "A".repeat(64)]) {
      expect(() =>
        write(`v2-bad-id-${bad.length}-${bad[0]}`, {
          ...LEGACY,
          schemaVersion: V2,
          manifestId: bad,
        }),
      ).toThrow(/not 64 lowercase hex/);
    }
  });

  it("refuses a schemaVersion it does not know how to read", () => {
    expect(() =>
      write("v3", {
        ...LEGACY,
        schemaVersion: "midgard-deployment-manifest-v3",
        manifestId: "d".repeat(64),
      }),
    ).toThrow(/unsupported schemaVersion/);
  });

  it("derives a legacy identity when no schemaVersion is declared", () => {
    const id = write("legacy", LEGACY);
    expect(id).toMatch(/^legacy-[0-9a-f]{64}$/);
    // Never the shared constant that made two deployments indistinguishable.
    expect(id).not.toBe("default");
  });

  it("derives the same legacy identity twice for the same contract set", () => {
    expect(write("legacy-a", LEGACY)).toBe(write("legacy-b", LEGACY));
  });

  it("derives a different legacy identity for a different contract set", () => {
    const other = {
      ...LEGACY,
      contracts: { stateQueueSpend: { scriptHash: "e".repeat(56) } },
    };
    expect(write("legacy-c", LEGACY)).not.toBe(write("legacy-d", other));
  });

  it("derives a different legacy identity per network", () => {
    expect(write("legacy-pp", LEGACY)).not.toBe(
      write("legacy-mn", { ...LEGACY, network: "Mainnet" }),
    );
  });

  it("refuses a createdAt it cannot parse", () => {
    // This reached the UI as the string "undefined" and threw when formatted.
    expect(() =>
      write("bad-date", { ...LEGACY, createdAt: "not a date" }),
    ).toThrow(/unparseable createdAt/);
  });

  it("ignores createdAt when computing the identity", () => {
    // Rewriting the file must not change the identity of the deployment it
    // describes, or every row already indexed becomes unreachable.
    const load = loadModified("touched", (doc) => {
      doc.createdAt = "2026-08-27T00:00:00.000Z";
      doc.updatedAt = "2026-08-27T00:00:00.000Z";
    });
    expect(load().deploymentId).toBe(loadManifest(FIXTURE).deploymentId);
  });
});
