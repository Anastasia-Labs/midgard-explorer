import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The vendored codec self-reports version 0.1.0 and always has, and its
 * package.json carries no gitHead, so neither field can detect drift. The
 * checksum can.
 *
 * If this fails, the tarball was rebuilt or replaced. Update PROVENANCE.md in
 * the same commit and say which Midgard commit the new one came from.
 */

const EXPECTED_SHA256 =
  "8f488be84d8343e0440cb664ff6ac5185b60bde0b0dc303200c57a749f69ada5";

const read = (name: string) =>
  readFileSync(new URL(`../vendor/${name}`, import.meta.url));

describe("vendored @al-ft/midgard-core", () => {
  it("is the tarball recorded in PROVENANCE.md", () => {
    const digest = createHash("sha256")
      .update(read("al-ft-midgard-core.tgz"))
      .digest("hex");
    expect(digest).toBe(EXPECTED_SHA256);
  });

  it("has a provenance record carrying that same checksum", () => {
    expect(read("PROVENANCE.md").toString("utf8")).toContain(EXPECTED_SHA256);
  });

  // The Lucid pin is the only field that distinguishes one build of this
  // package from another, since every one of them reports version 0.1.0.
  it("still declares the Lucid version the provenance record assumes", async () => {
    const pkg = JSON.parse(
      readFileSync(
        new URL("../node_modules/@al-ft/midgard-core/package.json", import.meta.url),
        "utf8",
      ),
    );
    expect(pkg.dependencies["@lucid-evolution/lucid"]).toBe("0.4.31");
  });
});
