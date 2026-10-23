import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeDeploymentId, loadManifest } from "../src/indexer/manifest.js";

/**
 * A conformance vector for the deployment identity.
 *
 * The explorer and the deployment tooling each compute `manifestId`, and two
 * implementations of one definition drift. The fixture below is the manifest
 * the tooling wrote for the 2026-07-15 preprod deployment, byte for byte, with
 * the identity it stamped on itself. If this test fails, the two definitions
 * have diverged and every row indexed under a recomputed identity would be
 * attributed to a deployment nobody can query back.
 *
 * The whole document is checked in rather than a reduced sample, because a
 * reduced sample hashes to something the tooling never produced and would only
 * prove this file agrees with itself.
 */
const DEPLOYED = new URL(
  "./fixtures/manifest-deployed-preprod.json",
  import.meta.url,
).pathname;

const raw = JSON.parse(readFileSync(DEPLOYED, "utf8"));

describe("deployment identity conformance", () => {
  it("recomputes the identity the deployment tooling stamped", () => {
    expect(raw.manifestId).toBe(
      "a56045c3133c4bfa52714c3371b46afedff7de450df53e213866aa79b5c5f7fd",
    );
    expect(computeDeploymentId(raw)).toBe(raw.manifestId);
  });

  it("accepts the deployed manifest end to end", () => {
    expect(loadManifest(DEPLOYED).deploymentId).toBe(raw.manifestId);
  });

  it("changes the identity when any hashed field changes", () => {
    for (const mutate of [
      (d: any) => (d.network = "Mainnet"),
      (d: any) => (d.referenceScriptDeployAddress = "addr_test1qq"),
      (d: any) => (d.hubOracleOneShot.outputIndex = 1),
      (d: any) => (d.referenceScriptAuthPolicy.policyId = "0".repeat(56)),
      (d: any) => (d.contracts.stateQueueSpend.scriptHash = "0".repeat(56)),
      (d: any) => (d.contracts.stateQueueSpend.contract.cborHex = "4d01"),
    ]) {
      const copy = JSON.parse(readFileSync(DEPLOYED, "utf8"));
      mutate(copy);
      expect(computeDeploymentId(copy)).not.toBe(raw.manifestId);
    }
  });

  it("ignores fields outside the identity", () => {
    // Touching the file must not restate the deployment it describes.
    for (const mutate of [
      (d: any) => (d.createdAt = "2000-01-01T00:00:00.000Z"),
      (d: any) => (d.updatedAt = "2000-01-01T00:00:00.000Z"),
      (d: any) => (d.hubOracleOneShot.status = "spent"),
      (d: any) => (d.referenceScriptAuthPolicy.postTimelockAudit = "changed"),
      (d: any) => (d.contracts.stateQueueSpend.refScriptUTxO = null),
      (d: any) => (d.steps = {}),
      (d: any) => (d.referenceScripts = {}),
    ]) {
      const copy = JSON.parse(readFileSync(DEPLOYED, "utf8"));
      mutate(copy);
      expect(computeDeploymentId(copy)).toBe(raw.manifestId);
    }
  });
});

/**
 * The deployed manifest is also the only complete statement of what has to be
 * scanned. These counts are what the coverage defect was measured against: 17
 * Spend, 17 Mint, 2 Withdraw and 4 unsuffixed entries declared, against 14, 14,
 * 1 and 2 retained.
 */
describe("deployed manifest coverage", () => {
  const m = loadManifest(DEPLOYED);
  const tally = (entries: { purpose: string }[]) =>
    entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.purpose] = (acc[e.purpose] ?? 0) + 1;
      return acc;
    }, {});

  it("keeps every purpose the manifest declares", () => {
    expect(tally(m.entries)).toEqual({ Spend: 17, Mint: 17, Withdraw: 2, None: 4 });
  });

  it("scans every purpose of every deployed contract", () => {
    // Nine of the forty entries are not scan targets: seven placeholders, and
    // the two duplicate rows a shared script produces within one purpose.
    expect(m.scanTargets.length).toBe(33);
    expect(tally(m.scanTargets)).toEqual({
      Spend: 14,
      Mint: 16,
      Withdraw: 1,
      None: 2,
    });
    for (const name of ["daParamsGovernorMint", "daAttestationMint"]) {
      expect(m.scanTargets.some((v) => v.entryName === name)).toBe(true);
    }
  });

  it("records the placeholders it excludes rather than losing them", () => {
    const excluded = m.entries.filter((e) => e.placeholder).map((e) => e.entryName);
    expect(excluded.sort()).toEqual(
      [
        "escapeHatchMint",
        "escapeHatchSpend",
        "fraudProofCatalogueSpend",
        "fraudProofInvalidRange",
        "fraudProofNonExistentInputNoIndex",
        "fraudProofSpend",
        "reserveWithdraw",
      ].sort(),
    );
  });
});
