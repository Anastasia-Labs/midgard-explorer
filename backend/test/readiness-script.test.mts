import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `pnpm readiness` as `pnpm dev` runs it.
 *
 * ADR 0003 lets a development instance serve L2 reads without a deployment
 * manifest, while `/readyz` keeps refusing one. When the Cardano index was
 * removed, its `--scope=l2` went with it, and `pnpm dev` silently began
 * running the strict check: a fresh contributor following the README was
 * refused over a manifest that setup never asks for.
 *
 * Every case points at a port nothing listens on, so the node database probe
 * fails the same way each time and only the manifest line differs.
 *
 * The script runs from an empty directory. Configuration loads `.env` from the
 * working directory, and dotenv-expand replaces a variable that is set but
 * empty with the file's value, so a contributor's own `backend/.env` would
 * otherwise decide what these cases measure.
 */

const UNREACHABLE = "postgresql://postgres:postgres@127.0.0.1:1/midgard_node_ci";

const backend = resolve(import.meta.dirname, "..");
const emptyDir = mkdtempSync(join(tmpdir(), "readiness-cwd-"));

const run = (args: string[], manifestPath: string) =>
  spawnSync(join(backend, "node_modules/.bin/ts-node"), [
    "--project", join(backend, "tsconfig.json"),
    join(backend, "scripts/probe-readiness.ts"),
    ...args,
  ], {
    cwd: emptyDir,
    encoding: "utf8",
    env: {
      ...process.env,
      POSTGRES_URL: UNREACHABLE,
      MIDGARD_READ_REPLICA_URL: "",
      MIDGARD_MANIFEST_PATH: manifestPath,
      DB_CONNECTION_TIMEOUT_MS: "1000",
    },
  });

const manifestLine = (stdout: string) =>
  stdout.split("\n").find((line) => / manifest/.test(line)) ?? "";

describe("the readiness script", () => {
  it("refuses an unset manifest by default, as /readyz does", () => {
    const result = run([], "");
    expect(manifestLine(result.stdout)).toMatch(/^NOT READY\s+manifest: MIDGARD_MANIFEST_PATH is not set/);
    expect(result.status).toBe(1);
  });

  it("reports an unset manifest as skipped when it is optional", () => {
    const result = run(["--manifest=optional"], "");
    expect(manifestLine(result.stdout)).toMatch(/^SKIPPED\s+manifest: MIDGARD_MANIFEST_PATH is not set/);
  });

  it("still refuses a configured manifest it cannot use when it is optional", () => {
    const dir = mkdtempSync(join(tmpdir(), "readiness-"));
    const path = join(dir, "manifest.json");
    writeFileSync(path, "{ not json");
    const result = run(["--manifest=optional"], path);
    expect(manifestLine(result.stdout)).toMatch(/^NOT READY\s+manifest:/);
    expect(result.status).toBe(1);
  });

  it("keeps refusing the node database whatever the manifest mode", () => {
    const result = run(["--manifest=optional"], "");
    expect(result.stdout).toMatch(/^NOT READY\s+node database:/m);
    expect(result.status).toBe(1);
  });

  it("rejects a manifest mode it does not know", () => {
    const result = run(["--manifest=sometimes"], "");
    expect(result.stderr).toMatch(/--manifest=sometimes/);
    expect(result.status).toBe(2);
  });
});
