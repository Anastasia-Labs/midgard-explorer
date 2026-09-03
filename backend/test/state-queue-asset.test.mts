import { describe, expect, it } from "vitest";
import {
  headerHashFromStateQueueAssets,
  stateQueuePolicyId,
  STATE_QUEUE_BLOCK_PREFIX,
  type AssetRef,
} from "../src/indexer/stateQueueAsset.js";
import type { ValidatorEntry } from "../src/indexer/manifest.js";

/**
 * The canonical block identity, and the rules that keep it canonical.
 *
 * The defect these guard against shipped and stayed green: the indexer wrote a
 * 32-byte `utxosRoot` into the column every consumer queried as a 28-byte header
 * hash. No test compared the stored key against the width the routes accept, so
 * nine local gates and hosted CI all passed while the block page's Cardano
 * evidence could not resolve for a single block in the deployment.
 */

const POLICY = "1e5769e8fd8e777c5995e9cbec5ef30b81abc3b36f78a8606332d19a";
const HEADER = "6f77bd238790f437971176e41b6c04ecf8eb04af01cf6c8fedfbcc8b";
const OTHER_HEADER = "d19d28c8f4202131b06f75d3029dac9854343d8a23fe7646ee578a55";

const token = (headerHash: string, over: Partial<AssetRef> = {}): AssetRef => ({
  policyId: POLICY,
  assetName: `${STATE_QUEUE_BLOCK_PREFIX}${headerHash}`,
  quantity: 1n,
  ...over,
});

describe("headerHashFromStateQueueAssets", () => {
  it("returns the suffix of the block token as the header hash", () => {
    const result = headerHashFromStateQueueAssets([token(HEADER)], POLICY);
    expect(result).toEqual({ ok: true, headerHash: HEADER });
  });

  /** The whole point. A 56-hex answer is what the routes validate and what the
   * node's own `header_hash` is; a 64-hex answer is the bug this replaces. */
  it("yields exactly 56 hex characters, which is what the routes accept", () => {
    const result = headerHashFromStateQueueAssets([token(HEADER)], POLICY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headerHash).toMatch(/^[0-9a-f]{56}$/);
  });

  it("ignores tokens of other policies", () => {
    const foreign = token(OTHER_HEADER, { policyId: "ff".repeat(28) });
    const result = headerHashFromStateQueueAssets([foreign, token(HEADER)], POLICY);
    expect(result).toEqual({ ok: true, headerHash: HEADER });
  });

  it("ignores assets of this policy that are not block tokens", () => {
    const other = { policyId: POLICY, assetName: "abcdef", quantity: 1n };
    const result = headerHashFromStateQueueAssets([other, token(HEADER)], POLICY);
    expect(result).toEqual({ ok: true, headerHash: HEADER });
  });

  /** A burn is a negative quantity and names a block leaving the queue, not one
   * being committed. */
  it("ignores a burned block token", () => {
    const burn = token(OTHER_HEADER, { quantity: -1n });
    const result = headerHashFromStateQueueAssets([burn, token(HEADER)], POLICY);
    expect(result).toEqual({ ok: true, headerHash: HEADER });
  });

  it("refuses rather than choosing when two block tokens are present", () => {
    const result = headerHashFromStateQueueAssets([token(HEADER), token(OTHER_HEADER)], POLICY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("2 state-queue block tokens");
  });

  it("refuses when no block token is present", () => {
    const result = headerHashFromStateQueueAssets([], POLICY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no state-queue block token");
  });

  /** A prefix match is not proof of a header hash. Anything else under this
   * policy that happens to start with the four bytes is refused by width. */
  it("refuses a suffix that is not 28 bytes", () => {
    const short = token("deadbeef");
    const result = headerHashFromStateQueueAssets([short], POLICY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not a 28-byte header hash");
  });

  it("refuses a 32-byte suffix, which is what the old key stored", () => {
    const asRoot = token("f671fe1d677219f81f40d99329a349654f71671302dddd48f3b5e8d141ea10a8");
    const result = headerHashFromStateQueueAssets([asRoot], POLICY);
    expect(result.ok).toBe(false);
  });
});

describe("stateQueuePolicyId", () => {
  const entry = (over: Partial<ValidatorEntry>): ValidatorEntry => ({
    entryName: "stateQueueMint",
    family: "stateQueue",
    purpose: "Mint",
    scriptHash: POLICY,
    address: "addr_test1",
    rewardAddress: null,
    policyId: POLICY,
    placeholder: false,
    ...over,
  });

  it("finds the stateQueue mint policy", () => {
    expect(stateQueuePolicyId([entry({})])).toBe(POLICY);
  });

  /** A spend entry's enterprise address is not somewhere block tokens are
   * issued, and its hash is not a minting policy for this purpose. */
  it("does not accept the stateQueue spend entry", () => {
    const spend = entry({
      entryName: "stateQueueSpend",
      purpose: "Spend",
      policyId: null,
    });
    expect(stateQueuePolicyId([spend])).toBeNull();
  });

  it("does not accept a reviewed placeholder", () => {
    expect(stateQueuePolicyId([entry({ placeholder: true })])).toBeNull();
  });

  it("returns null when the manifest declares no stateQueue mint", () => {
    const other = entry({ entryName: "depositMint", family: "deposit" });
    expect(stateQueuePolicyId([other])).toBeNull();
  });
});
