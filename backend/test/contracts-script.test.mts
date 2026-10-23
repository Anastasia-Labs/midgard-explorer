import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;
let script: string;
const source = () => join(root, "backend/contracts");
const target = () => join(root, "frontend/contracts/src");
const run = (mode: string) => spawnSync(process.execPath, [script, mode], { encoding: "utf8" });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "explorer-contracts-"));
  mkdirSync(join(root, "backend/scripts"), { recursive: true });
  script = join(root, "backend/scripts/contracts.mjs");
  copyFileSync(new URL("../scripts/contracts.mjs", import.meta.url), script);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("refuses missing or empty sources without deleting an existing copy", () => {
  mkdirSync(target(), { recursive: true });
  const existing = join(target(), "response.ts");
  writeFileSync(existing, "keep this");
  for (const empty of [false, true]) {
    if (empty) mkdirSync(source(), { recursive: true });
    expect(run("write").status).toBe(1);
    expect(run("check").status).toBe(1);
    expect(readFileSync(existing, "utf8")).toBe("keep this");
  }
});

it("does not report success when both trees are absent", () => {
  expect(run("check").status).toBe(1);
  expect(existsSync(target())).toBe(false);
});

it("creates the target, detects drift and removes obsolete generated files", () => {
  mkdirSync(source(), { recursive: true });
  writeFileSync(join(source(), "response.ts"), "export type Response = string;\n");
  expect(run("check").status).toBe(1);
  expect(run("write").status).toBe(0);
  expect(run("check").status).toBe(0);
  writeFileSync(join(target(), "response.ts"), "hand edited");
  writeFileSync(join(target(), "obsolete.ts"), "obsolete");
  expect(run("check").status).toBe(1);
  expect(run("write").status).toBe(0);
  expect(existsSync(join(target(), "obsolete.ts"))).toBe(false);
  expect(run("check").status).toBe(0);
});
