import { beforeAll, describe, expect, it } from "vitest";
import { reachable as isReachable } from "./helpers/reachable.mjs";
import {
  NODE_TABLES,
  missingRelations,
  probeManifest,
  probeNodeDatabase,
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
 *
 * Two probes remain, because readiness now has one scope. The index probes and
 * their cursor-agreement rules went with the explorer-owned Cardano index.
 */

let reachable = false;

beforeAll(async () => {
  reachable = await isReachable("node", "readiness probes");
});

/** Answers like a database that has none of the relations asked for. */
const empty: Queryable = {
  $queryRawUnsafe: (async () => []) as Queryable["$queryRawUnsafe"],
};

describe("readiness probes", () => {
  it("accepts a node database that has every relation the read path uses", async () => {
    if (!reachable) return;
    await expect(probeNodeDatabase()).resolves.toBeUndefined();
  });

  /** The negative case, which is what makes the positive one mean something. */
  it("names the relations a database is missing rather than reporting ready", async () => {
    const missing = await missingRelations(empty, NODE_TABLES);
    expect(missing).toEqual([...NODE_TABLES]);
  });

  it("finds nothing missing in a database that has them", async () => {
    if (!reachable) return;
    const { prisma } = await import("../src/db.js");
    expect(await missingRelations(prisma as unknown as Queryable, NODE_TABLES)).toEqual([]);
  });

  it("accepts the manifest this repository ships", async () => {
    await expect(probeManifest()).resolves.toBeUndefined();
  });
});
