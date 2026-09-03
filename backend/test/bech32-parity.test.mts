import { describe, expect, it } from "vitest";
import { scriptHashToAddress, scriptHashToRewardAddress } from "../src/indexer/bech32.js";
import { loadManifest } from "../src/indexer/manifest.js";

/**
 * The addresses the indexer scans are the addresses the deployment declares.
 *
 * Address derivation decides which chain traffic counts as Midgard. Get it
 * wrong and the explorer either misses the protocol's own transactions or
 * reports somebody else's as Midgard activity, and both look like working
 * software.
 *
 * These vectors were CAPTURED from the running derivation, not written by
 * hand. A first version of this file carried a plausible-looking address I had
 * typed rather than measured, and it failed immediately; an invented vector
 * that happened to pass would have been far worse, pinning the derivation to a
 * value nothing produced. The two implementations were checked to agree on
 * every entry of the deployed manifest on both networks before the replacement
 * landed. They are here so the derivation cannot change
 * silently under a Lucid upgrade: a dependency bump that altered an address
 * would otherwise surface as an explorer that had quietly stopped seeing the
 * protocol.
 */

const manifest = loadManifest(new URL("./fixtures/manifest-sample.json", import.meta.url).pathname);

const stateQueue = manifest.entries.find((e) => e.entryName === "stateQueueSpend");

describe("script hash to address", () => {
  it("has manifest entries to check, so this gate is not measuring nothing", () => {
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(stateQueue, "the sample manifest no longer declares stateQueueSpend").toBeDefined();
  });

  /** A known pair, so an upgrade that changed the derivation fails here rather
   * than as an explorer that indexes nothing. */
  it("derives the recorded preprod address for stateQueueSpend", () => {
    if (!stateQueue) return;
    expect(scriptHashToAddress(stateQueue.scriptHash, "preprod")).toBe(
      "addr_test1wpt39wx3rdvwrl80futqv7emqljqquaxggfqzgyeqpdjrkqhge828",
    );
  });

  it("derives a mainnet address that differs only in its prefix", () => {
    if (!stateQueue) return;
    const pre = scriptHashToAddress(stateQueue.scriptHash, "preprod");
    const main = scriptHashToAddress(stateQueue.scriptHash, "mainnet");
    expect(main).not.toBe(pre);
    expect(main.startsWith("addr1")).toBe(true);
    expect(pre.startsWith("addr_test1")).toBe(true);
  });

  /** A reward address is not an address with a different prefix: a withdraw
   * validator is executed against this and never against the payment address,
   * so confusing them makes a whole family of executions invisible. */
  it("derives a reward address distinct from the payment address", () => {
    if (!stateQueue) return;
    const addr = scriptHashToAddress(stateQueue.scriptHash, "preprod");
    const reward = scriptHashToRewardAddress(stateQueue.scriptHash, "preprod");
    expect(reward).not.toBe(addr);
    expect(reward).toBe("stake_test17pt39wx3rdvwrl80futqv7emqljqquaxggfqzgyeqpdjrkqhq8lad");
  });

  it("derives a stable address for every entry the manifest declares", () => {
    const addresses = manifest.entries.map((e) => scriptHashToAddress(e.scriptHash, "preprod"));
    expect(addresses.every((a) => a.startsWith("addr_test1"))).toBe(true);
    // One address per distinct hash. A collision would mean two contracts
    // sharing a scan target, which the placeholder rules exist to prevent.
    const distinctHashes = new Set(manifest.entries.map((e) => e.scriptHash)).size;
    expect(new Set(addresses).size).toBe(distinctHashes);
  });
});
