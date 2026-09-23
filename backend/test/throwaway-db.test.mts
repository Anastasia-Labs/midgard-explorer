import { describe, expect, it } from "vitest";
import {
  assertThrowawayName,
  checksum,
  dropDatabase,
  isMarkedThrowaway,
  throwawayName,
  withThrowawayNodeDb,
} from "./helpers/throwawayDb.mjs";

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

describe("throwaway naming", () => {
  it("refuses every name this harness could not have generated", () => {
    // The names a mistake would actually reach for, plus the ones a suffix
    // check used to let through. `customer_data_bench` is the case that made
    // the old guard unsafe: it looked like ours and was not.
    for (const name of [
      "midgard",
      "midgard_explorer",
      "postgres",
      "template1",
      "customer_data_bench",
      "node_a1b2c3d4_bench",
      "bench_",
      "bench_notlonghex",
      "bench_ABCDEF01234567890123456789012345",
      'bench_00000000000000000000000000000000"; DROP DATABASE midgard; --',
    ]) {
      expect(() => assertThrowawayName(name), name).toThrow(/refusing/);
    }
  });

  it("accepts what throwawayName produces, and produces distinct names", () => {
    const a = throwawayName();
    const b = throwawayName();
    expect(() => assertThrowawayName(a)).not.toThrow();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^bench_[0-9a-f]{32}$/);
  });
});

db("ownership guard", () => {
  it("refuses to drop a well-formed name that carries no mark", async () => {
    // The database does not exist, so it cannot be marked. The point is that
    // the refusal comes from the missing mark rather than from the name.
    const name = throwawayName();
    expect(await isMarkedThrowaway(name)).toBe(false);
    await expect(dropDatabase(name)).rejects.toThrow(/not marked/);
  }, 30_000);
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
    let name = "";
    await expect(
      withThrowawayNodeDb(async (client) => {
        const { rows } = await client.query<{ db: string }>(
          `select current_database() as db`,
        );
        name = rows[0].db;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(name).toMatch(/^bench_[0-9a-f]{32}$/);
    // It is gone, so it no longer carries the mark.
    expect(await isMarkedThrowaway(name)).toBe(false);
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
