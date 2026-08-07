import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  indexerPrisma,
  getSyncCursor,
  setSyncCursor,
} from "../src/indexer/db.js";

/**
 * The explorer's own database. Unlike the node's Postgres, this one is ours:
 * we create it, migrate it, and write to it. These tests are the first that
 * assert the explorer can persist anything at all.
 */

let reachable = false;

beforeAll(async () => {
  try {
    await indexerPrisma.$queryRaw`SELECT 1;`;
    reachable = true;
  } catch (err) {
    console.warn(
      `Skipping: indexer Postgres unreachable on 5435. Run "docker compose up -d explorer-postgres". ${String(err)}`,
    );
  }
});

afterAll(async () => {
  if (reachable) {
    await indexerPrisma.syncCursor.deleteMany({ where: { source: "test" } });
    await indexerPrisma.$disconnect();
  }
});

/**
 * The tripwire. Skipping keeps local runs convenient, but a release or CI run
 * that sets REQUIRE_DB=1 must fail loudly if the database never came up,
 * rather than reporting a suite of skips as success.
 */
describe("database availability", () => {
  it("was reachable when REQUIRE_DB is set", () => {
    if (process.env.REQUIRE_DB !== "1") return;
    expect(reachable).toBe(true);
  });
});

describe("sync cursor", () => {
  it("returns null for an unknown source", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    expect(await getSyncCursor("nope")).toBeNull();
  });

  it("round-trips a cursor", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await setSyncCursor("test", 4940074);
    const c = await getSyncCursor("test");
    expect(c?.lastBlockHeight).toBe(4940074);
  });

  it("overwrites rather than duplicating", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await setSyncCursor("test", 4940074);
    await setSyncCursor("test", 4980661);
    const c = await getSyncCursor("test");
    expect(c?.lastBlockHeight).toBe(4980661);
    const all = await indexerPrisma.syncCursor.findMany({
      where: { source: "test" },
    });
    expect(all).toHaveLength(1);
  });
});
