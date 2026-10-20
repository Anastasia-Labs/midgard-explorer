import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adminUrl, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";
import { reachable } from "./helpers/reachable.mjs";

/**
 * `pnpm compat check --database <url>`, the command that compares this build
 * with a running node.
 *
 * `pnpm compat` passes the repository root as `..`, and the database mode
 * handed that relative path to `createRequire`, which takes only an absolute
 * one. Every database check crashed before it connected. CI runs the fixture
 * mode only, which never reaches that line.
 *
 * The URL names a port nothing listens on, so a fixed script fails on the
 * connection and never on its own arguments.
 */
describe("compat check against a database", () => {
  it("reaches the database when the root is given relative, as pnpm compat does", () => {
    const result = spawnSync(
      "node",
      ["scripts/compat.mjs", "..", "check", "--database", "postgresql://u:p@127.0.0.1:1/none"],
      { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
    );
    const output = result.stdout + result.stderr;
    expect(output).not.toMatch(/ERR_INVALID_ARG_VALUE/);
    expect(output).toMatch(/ECONNREFUSED/);
    expect(result.status).not.toBe(0);
  });
});

/**
 * The pin and a database built from the same fixture must agree.
 *
 * The pin is computed by parsing the fixture's DDL, and a database is read from
 * its catalog. A parser that misreads the fixture produces a pin no real
 * database matches: pg_dump ends `tx_admissions` with `) WITH (...);`, and the
 * parser ran on into the next statements and pinned `CREATE`, `START` and
 * `tx_rejections.created_at` as columns of `tx_admissions`.
 */
describe("compat check against the committed fixture", () => {
  it("calls a database built from the fixture compatible", async () => {
    if (!(await reachable("node", "compat against the fixture"))) return;
    await withThrowawayNodeDb(async (client) => {
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const result = spawnSync(
        "node",
        ["scripts/compat.mjs", "..", "check", "--database", adminUrl(name)],
        { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
      );
      expect(result.stdout + result.stderr).toMatch(/^compatible/m);
      expect(result.status).toBe(0);
    });
  });
});
