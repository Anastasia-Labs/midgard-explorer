import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest } from "../src/indexer/manifest.js";

/**
 * `loadManifest` sits on request paths: `/api/withdrawals/:page` calls it to
 * learn the network, and four of the `/api/l1/*` handlers call it to attribute
 * a script hash to a validator. Every one of those calls used to read the file
 * synchronously, parse it, validate it, and derive a bech32 address per
 * validator, on the request thread, for every request.
 *
 * The cache keys on the file's own modification time, so an operator who edits
 * a manifest still sees the change without a restart, and a deployment that
 * never touches it pays for one read.
 */

const MANIFEST = {
  network: "Preprod",
  createdAt: "2026-07-15T17:25:29.000Z",
  contracts: {
    stateQueueSpend: { scriptHash: "a".repeat(56) },
    depositSpend: { scriptHash: "b".repeat(56) },
  },
};

function writeManifest(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "midgard-manifest-"));
  const path = join(dir, "contract-deployment-info.json");
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe("loadManifest", () => {
  it("reads the file once for repeated calls", () => {
    const path = writeManifest(MANIFEST);
    const first = loadManifest(path);
    const second = loadManifest(path);
    // Identity, not equality: a second parse would produce an equal object and
    // prove nothing about whether the file was read again.
    expect(second).toBe(first);
  });

  it("sees an edited manifest without a restart", () => {
    const path = writeManifest(MANIFEST);
    expect(loadManifest(path).validators).toHaveLength(2);

    writeFileSync(
      path,
      JSON.stringify({
        ...MANIFEST,
        contracts: { stateQueueSpend: { scriptHash: "c".repeat(56) } },
      }),
    );
    // Same-second writes are the normal case for a test and a real edit alike,
    // and a whole-second mtime would hide one. Push the timestamp so the change
    // is visible whatever the filesystem's resolution.
    const now = statSync(path).mtime;
    utimesSync(path, now, new Date(now.getTime() + 2_000));

    const reloaded = loadManifest(path);
    expect(reloaded.validators).toHaveLength(1);
    expect(reloaded.validators[0]!.scriptHash).toBe("c".repeat(56));
  });

  it("keeps rejecting a manifest it cannot read", () => {
    const path = writeManifest({ network: "Preprod", contracts: null });
    expect(() => loadManifest(path)).toThrow(/no contracts key/);
    // Twice: a cache that stored the failure would answer the second call with
    // something other than the error.
    expect(() => loadManifest(path)).toThrow(/no contracts key/);
  });
});
