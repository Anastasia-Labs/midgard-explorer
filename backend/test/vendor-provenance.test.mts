import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The vendored Midgard package graph.
 *
 * Every package self-reports version 0.1.0 and carries no gitHead, so neither
 * field identifies the code. The record that does is vendor/midgard/manifest.json,
 * written by scripts/vendor-midgard.sh: the commit, the deployment profile the
 * packages were compiled for, and a sha256 per tarball and patch.
 *
 * If this fails, a tarball was rebuilt or replaced. Rerun the script for the
 * commit and profile you mean, and update PROVENANCE.md in the same change.
 */

const vendor = (path: string) => new URL(`../vendor/${path}`, import.meta.url);
const text = (path: string) => readFileSync(vendor(path), "utf8");
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(vendor(path))).digest("hex");

type Manifest = {
  commit: string;
  profile: string;
  tarballs: Record<string, string>;
  patches: Record<string, string>;
};
const manifest = JSON.parse(text("midgard/manifest.json")) as Manifest;
const provenance = text("PROVENANCE.md");

describe("the vendored Midgard graph", () => {
  it("names one full commit and one deployment profile", () => {
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.profile).toBe("preprod-testing");
  });

  it("holds exactly the tarballs the manifest records, with those checksums", () => {
    const onDisk = readdirSync(vendor("midgard")).filter((f) => f.endsWith(".tgz"));
    expect(onDisk.sort()).toEqual(Object.keys(manifest.tarballs).sort());
    for (const [file, digest] of Object.entries(manifest.tarballs)) {
      expect(sha256(`midgard/${file}`), file).toBe(digest);
    }
    for (const [file, digest] of Object.entries(manifest.patches)) {
      expect(sha256(`midgard/patches/${file}`), file).toBe(digest);
    }
  });

  it("is described by PROVENANCE.md: commit, profile and every checksum", () => {
    expect(provenance).toContain(manifest.commit);
    expect(provenance).toContain(manifest.profile);
    for (const digest of [
      ...Object.values(manifest.tarballs),
      ...Object.values(manifest.patches),
    ]) {
      expect(provenance).toContain(digest);
    }
  });

  it("resolves every internal reference to the tarball beside it", () => {
    const workspace = readFileSync(
      new URL("../pnpm-workspace.yaml", import.meta.url),
      "utf8",
    );
    for (const file of Object.keys(manifest.tarballs)) {
      expect(workspace, file).toContain(`file:vendor/midgard/${file}`);
    }
    for (const file of Object.keys(manifest.patches)) {
      expect(workspace, file).toContain(`vendor/midgard/patches/${file}`);
    }
  });

  // Core and the SDK take Lucid as a peer. A backend on another Lucid would
  // hand them its own, which is the mismatch this pins against.
  it("installs the Lucid release the graph was built against", () => {
    const installed = (name: string) =>
      JSON.parse(
        readFileSync(
          new URL(`../node_modules/${name}/package.json`, import.meta.url),
          "utf8",
        ),
      );
    const lucid = installed("@lucid-evolution/lucid").version;
    // Core lists Lucid as a dependency, the SDK as a peer.
    const wanted = (name: string) => {
      const pkg = installed(name);
      return pkg.dependencies?.["@lucid-evolution/lucid"] ?? pkg.peerDependencies?.["@lucid-evolution/lucid"];
    };
    expect(wanted("@al-ft/midgard-core")).toBe(lucid);
    expect(wanted("@al-ft/midgard-sdk")).toBe(lucid);
  });
});
