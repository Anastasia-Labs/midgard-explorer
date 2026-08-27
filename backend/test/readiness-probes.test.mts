import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import {
  INDEX_TABLES,
  missingRelations,
  probeIndexDatabase,
  probeManifest,
  type Queryable,
} from "../src/server/probes.js";

/**
 * Readiness used to be two `SELECT 1` calls, which report ready for a database
 * that has none of the tables either query path uses. That is exactly what CI
 * provisioned: a generic empty PostgreSQL that the boot check called healthy
 * while the suite would have failed on a missing relation.
 *
 * These assert the probes discriminate. Without the negative case, a probe that
 * silently checked nothing would pass the positive case just as well.
 */

let reachable = false;

beforeAll(async () => {
  try {
    await Promise.race([
      indexerPrisma.$queryRaw`SELECT 1;`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("probe timed out")), 3000),
      ),
    ]);
    reachable = true;
  } catch (err) {
    if (process.env.REQUIRE_DB === "1") throw err;
    console.warn(`Skipping: indexer Postgres unreachable. ${String(err)}`);
  }
});

afterAll(async () => {
  if (reachable) await indexerPrisma.$disconnect().catch(() => undefined);
});

describe("readiness probes", () => {
  it("accepts an index that has every relation and finished its migrations", async () => {
    if (!reachable) return;
    await expect(probeIndexDatabase()).resolves.toBeUndefined();
  });

  it("names the relations a database does not have", async () => {
    if (!reachable) return;
    const client = indexerPrisma as unknown as Queryable;
    const missing = await missingRelations(client, [
      "l1_event",
      "a_table_that_does_not_exist",
      "another_missing_table",
    ]);
    // The discriminating case. A probe that returned an empty list whatever it
    // was asked would satisfy the test above and prove nothing.
    expect(missing).toEqual([
      "a_table_that_does_not_exist",
      "another_missing_table",
    ]);
  });

  it("reports every required index relation as present", async () => {
    if (!reachable) return;
    const client = indexerPrisma as unknown as Queryable;
    expect(await missingRelations(client, INDEX_TABLES)).toEqual([]);
  });

  it("checks the manifest, since a bad one serves queries that return nothing", async () => {
    await expect(probeManifest()).resolves.toBeUndefined();
  });
});
