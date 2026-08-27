import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contractFamily,
  findStubHashes,
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

const ESCAPE_HATCH = "bd3ae991b5aafccafe5ca70758bd36a9b2f872f57f6d3a1ffa0eb777";
const FRAUD_CATALOGUE = "22c9a103ed3f2fa97c982d76d6e2af50c5d54ac306983b196c8fcdab";
const DA_PARAMS = "008c416cdcfe3081a32202a605b777e3790947cdd00900cf72343958";
const DA_ATTESTATION = "65976139558770f54efbe6a16cc2ae078007e347c2bff6e8e9f3a948";

describe("contractFamily", () => {
  it("strips purpose suffixes", () => {
    expect(contractFamily("daParamsGovernorSpend")).toBe("daParamsGovernor");
    expect(contractFamily("daParamsGovernorMint")).toBe("daParamsGovernor");
    expect(contractFamily("reserveWithdraw")).toBe("reserve");
    expect(contractFamily("reserveObserver")).toBe("reserve");
  });

  it("leaves a name with no purpose suffix alone", () => {
    expect(contractFamily("fraudProofInvalidRange")).toBe(
      "fraudProofInvalidRange",
    );
  });
});

/**
 * The rule that matters. A naive "shared script hash means stub" test would
 * wrongly exclude daParamsGovernor and daAttestation, which are real contracts
 * whose spend and mint purposes compile to one script. Only a hash spanning
 * more than one contract FAMILY indicates a placeholder.
 */
describe("findStubHashes", () => {
  const { contracts } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const stubs = findStubHashes(contracts);

  it("flags hashes spanning multiple contract families", () => {
    expect(stubs.has(ESCAPE_HATCH)).toBe(true);
    expect(stubs.has(FRAUD_CATALOGUE)).toBe(true);
  });

  it("does not flag spend/mint pairs of one contract", () => {
    expect(stubs.has(DA_PARAMS)).toBe(false);
    expect(stubs.has(DA_ATTESTATION)).toBe(false);
  });

  it("flags exactly two hashes in this manifest", () => {
    expect(stubs.size).toBe(2);
  });
});

describe("loadManifest", () => {
  const m = loadManifest(FIXTURE);

  it("reads the network", () => {
    expect(m.network).toBe("preprod");
  });

  it("excludes stub validators from the address list", () => {
    const hashes = m.validators.map((v) => v.scriptHash);
    expect(hashes).not.toContain(ESCAPE_HATCH);
    expect(hashes).not.toContain(FRAUD_CATALOGUE);
  });

  it("deduplicates by script hash, not by family", () => {
    const depositEntries = m.validators.filter((v) => v.family === "deposit");
    expect(depositEntries.length).toBe(2);
    const depositAddresses = depositEntries.map((v) => v.address);
    expect(new Set(depositAddresses).size).toBe(2);
  });

  it("still yields one entry for shared-hash contracts", () => {
    const daParamsEntries = m.validators.filter(
      (v) => v.family === "daParamsGovernor",
    );
    expect(daParamsEntries.length).toBe(1);
  });

  it("preserves the unmodified entry name", () => {
    const depositSpend = m.validators.find((v) => v.entryName === "depositSpend");
    expect(depositSpend).toBeDefined();
    expect(depositSpend?.family).toBe("deposit");
    const depositMint = m.validators.find((v) => v.entryName === "depositMint");
    expect(depositMint).toBeDefined();
    expect(depositMint?.family).toBe("deposit");
  });

  it("derives a usable address for each validator", () => {
    for (const v of m.validators) {
      expect(v.address.startsWith("addr_test1w")).toBe(true);
    }
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
 * them. The rules below are what make a shared constant unreachable.
 */
describe("deployment identity", () => {
  it("uses the declared manifestId for a versioned manifest", () => {
    expect(loadManifest(FIXTURE).deploymentId).toBe(
      "268c40fc3d521049e970cd3b3e0be3ef6ae1bd0acc034d580be806896b6a7f7e",
    );
    expect(loadManifest(FIXTURE).schemaVersion).toBe(
      "midgard-deployment-manifest-v2",
    );
  });

  it("refuses a versioned manifest that states no identity", () => {
    expect(() =>
      write("v2-no-id", { ...LEGACY, schemaVersion: V2 }),
    ).toThrow(/no manifestId/);
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
});
