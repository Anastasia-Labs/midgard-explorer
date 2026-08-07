import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  contractFamily,
  findStubHashes,
  loadManifest,
} from "../src/indexer/manifest.js";

const FIXTURE = new URL(
  "./fixtures/manifest-sample.json",
  import.meta.url,
).pathname;

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

  it("deduplicates families that share a hash", () => {
    const families = m.validators.map((v) => v.family);
    expect(new Set(families).size).toBe(families.length);
    expect(families).toContain("daParamsGovernor");
  });

  it("derives a usable address for each validator", () => {
    for (const v of m.validators) {
      expect(v.address.startsWith("addr_test1w")).toBe(true);
    }
  });
});
