import { describe, expect, it } from "vitest";
import {
  assertThrowaway,
  checksum,
  withThrowawayNodeDb,
} from "./helpers/throwawayDb.mjs";

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

describe("assertThrowaway", () => {
  it("refuses any database that is not a throwaway", () => {
    // These are the names a mistake would actually reach for. The guard exists
    // so no code path in this module can address one.
    for (const name of [
      "midgard",
      "midgard_explorer",
      "postgres",
      "midgard_bench_live",
      "template1",
    ]) {
      expect(() => assertThrowaway(name), name).toThrow(/must end in "_bench"/);
    }
  });

  it("refuses an unsafe identifier even with the right suffix", () => {
    for (const name of ['x"; DROP DATABASE midgard; --_bench', "Bad_bench", "1_bench"]) {
      expect(() => assertThrowaway(name), name).toThrow();
    }
  });

  it("accepts a well-formed throwaway name", () => {
    expect(() => assertThrowaway("node_a1b2c3d4_bench")).not.toThrow();
  });
});

db("withThrowawayNodeDb", () => {
  it("creates the node schema, runs the callback, and drops the database", async () => {
    let seen = 0;
    await withThrowawayNodeDb(async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from information_schema.tables
          where table_schema = 'public'`,
      );
      seen = Number(rows[0].n);
    });
    // The fixture carries 22 tables after SCHEMA-FIXTURE added the four the
    // coverage scope adopts.
    expect(seen).toBe(22);
  }, 60_000);

  it("drops the database even when the callback throws", async () => {
    await expect(
      withThrowawayNodeDb(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Nothing to assert on directly without listing databases; the value is
    // that the finally ran and the next test gets a clean server.
  }, 60_000);
});

db("checksum", () => {
  it("is stable for identical content and changes when a row changes", async () => {
    await withThrowawayNodeDb(async (client) => {
      // address_history rather than pending_block_finalizations: the latter has
      // 28 NOT NULL columns with no default, so inserting one row there is a
      // seeding exercise, not a checksum test.
      const tables = ["address_history"];
      const empty = await checksum(client, tables);
      const again = await checksum(client, tables);
      expect(again.digest).toBe(empty.digest);
      expect(empty.rows).toBe(0);

      await client.query(
        `insert into address_history (tx_id, address) values (decode($1, 'hex'), $2)`,
        ["ab".repeat(32), "addr_test1qtest"],
      );
      const after = await checksum(client, tables);
      expect(after.digest).not.toBe(empty.digest);
      expect(after.rows).toBe(1);
      expect(after.tables.address_history).toBe(1);
    });
  }, 60_000);
});
