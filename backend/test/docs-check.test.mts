import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;
const script = new URL("../scripts/docs-check.mjs", import.meta.url).pathname;
const run = () => spawnSync(process.execPath, [script, root], { encoding: "utf8" });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "explorer-docs-check-"));
  for (const dir of ["backend", "frontend", "docs/release", "docs/decisions"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, ".gitignore"), "docs/private.md\n");
  for (const file of ["README.md", "backend/README.md", "frontend/README.md"]) {
    writeFileSync(join(root, file), "# Documentation\n");
  }
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "."]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("ignores private drafts even when they contain obsolete commands", () => {
  writeFileSync(join(root, "docs/private.md"), "`npm run obsolete`\n");
  expect(run().status).toBe(0);
});

it("checks non-ignored additions before they are staged", () => {
  writeFileSync(join(root, "docs/new.md"), "[missing](missing.md)\n");
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("does not exist");
});

it("refuses a published document linking to a private draft", () => {
  writeFileSync(join(root, "docs/private.md"), "private\n");
  writeFileSync(join(root, "README.md"), "[private](docs/private.md)\n");
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("not tracked");
});
