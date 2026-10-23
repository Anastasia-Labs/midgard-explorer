import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NODE_TABLES } from "../src/server/probes.js";

/**
 * Three lists name the node tables the explorer reads: the SQL in `src/db`,
 * `NODE_TABLES` (which readiness checks and the compatibility fingerprint
 * covers), and the grants in `sql/explorer-reader-role.sql`. When a query
 * started reading the follower tables and neither list moved, readiness kept
 * answering ready while every page that read them failed with "permission
 * denied" under the production role. These hold the three lists together.
 */

const at = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const nodeTables = [
  ...at("./fixtures/schema/midgard-node.sql").matchAll(
    /CREATE (?:UNLOGGED )?TABLE (?:public\.)?"?(\w+)"?/g,
  ),
].map((m) => m[1]!);

const readPath = readdirSync(new URL("../src/db/", import.meta.url))
  .filter((file) => file.endsWith(".ts"))
  .map((file) => at(`../src/db/${file}`))
  .join("\n");

const queried = nodeTables.filter((table) =>
  new RegExp(`\\b(?:FROM|JOIN)\\s+(?:public\\.)?"?${table}"?\\b`, "i").test(readPath),
);

const granted = /wanted text\[\] := ARRAY\[([\s\S]*?)\];/
  .exec(at("../sql/explorer-reader-role.sql"))![1]!
  .match(/'(\w+)'/g)!
  .map((quoted) => quoted.slice(1, -1));

describe("the node tables the read path queries", () => {
  it("finds the read path's tables in the source", () => {
    // The negative control: a scan that matched nothing would pass below.
    expect(queried).toContain("blocks");
    expect(queried).toContain("node_landed_blocks");
  });

  it("are all checked by readiness", () => {
    expect(queried.filter((t) => !(NODE_TABLES as readonly string[]).includes(t))).toEqual([]);
  });

  it("are exactly what the read role is granted", () => {
    expect([...granted].sort()).toEqual([...NODE_TABLES].sort());
  });
});
