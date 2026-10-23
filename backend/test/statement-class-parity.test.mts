import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as bench from "../bench/attribution.mjs";
import * as server from "../src/db/statementClass.js";

/**
 * The benchmark and the production metrics classify statements with two copies
 * of one function, because no single module loads in both runtimes. A route
 * budget met in the benchmark must be counted the same way in production, so
 * the copies are held to agree on every query text the server can issue.
 */

/** Every SQL template in the server's query modules, as the database receives it. */
function serverQueries(): string[] {
  const dir = new URL("../src/db/", import.meta.url).pathname;
  const texts: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const match of source.matchAll(/\$queryRaw(?:Unsafe)?(?:<[^`]*?>)?`([^`]*)`/g)) {
      texts.push(match[1].replace(/\$\{[^}]*\}/g, "$1"));
    }
  }
  return texts;
}

const EDGES = [
  "BEGIN",
  "begin",
  "  COMMIT",
  "ROLLBACK",
  "SAVEPOINT s1",
  "RELEASE SAVEPOINT s1",
  "START TRANSACTION",
  "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
  "SELECT last_slot FROM sync_cursor WHERE source = $1",
  "SELECT deployment_id\n  FROM index_binding",
  "SELECT status, class FROM sessions",
  "WITH legacy AS (\n  SELECT header_hash FROM blocks\n)\nSELECT 1",
];

describe("the two statement classifiers", () => {
  it("find query texts to compare, so agreement is not vacuous", () => {
    expect(serverQueries().length).toBeGreaterThan(20);
  });

  it("agree on every server query and every edge case", () => {
    for (const query of [...serverQueries(), ...EDGES]) {
      expect(server.normalizeQuery(query)).toBe(bench.normalizeQuery(query));
      const normalized = bench.normalizeQuery(query);
      expect(server.classifyStatement(normalized), normalized).toBe(
        bench.classifyStatement(normalized),
      );
    }
  });
});
