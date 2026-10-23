import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { createDbProbe, hasStatementStats } from "../bench/pgStats.mjs";

/**
 * The probe, against the dedicated benchmark server.
 *
 * The property that matters is that an unavailable probe reports unavailable
 * rather than zero: a "at most four statements" budget is trivially satisfied
 * by a probe that always answers zero, which is the most convincing false green
 * available to us.
 */

const BENCH_URL = process.env.BENCH_POSTGRES_URL;
const db = process.env.REQUIRE_DB === "1" && BENCH_URL ? describe : describe.skip;

db("createDbProbe", () => {
  it("counts the statements and blocks a query actually costs", async () => {
    const client = new Client({ connectionString: BENCH_URL });
    await client.connect();
    try {
      expect(await hasStatementStats(client)).toBe(true);
      const probe = await createDbProbe(client);
      expect(probe.available).toBe(true);

      await probe.reset();
      const before = await probe.read();
      await client.query(`SELECT count(*) FROM generate_series(1, 1000)`);
      await client.query(`SELECT 1`);
      const after = await probe.read();

      expect(after.statements).toBeGreaterThan(before.statements);
      // Two statements at least; the reset itself is filtered out.
      expect(after.statements).toBeGreaterThanOrEqual(2);
      expect(after.execMs).toBeGreaterThanOrEqual(0);
    } finally {
      await client.end();
    }
  }, 60_000);

  it("reports shared blocks as hit plus read, not read alone", async () => {
    const client = new Client({ connectionString: BENCH_URL });
    await client.connect();
    try {
      await client.query(`DROP TABLE IF EXISTS probe_scan`);
      await client.query(
        `CREATE TABLE probe_scan AS SELECT g AS n, repeat('x', 200) AS pad
           FROM generate_series(1, 20000) g`,
      );
      const probe = await createDbProbe(client);
      // Warm the buffers first, so the scan below reads nothing from disk.
      await client.query(`SELECT count(*) FROM probe_scan`);
      await probe.reset();
      await client.query(`SELECT count(*) FROM probe_scan`);
      const work = await probe.read();

      // A scan served entirely from shared buffers has zero reads. Counting
      // reads alone would report zero work for a full table scan.
      expect(work.sharedBlocks).toBeGreaterThan(100);
      await client.query(`DROP TABLE probe_scan`);
    } finally {
      await client.end();
    }
  }, 120_000);

  it("says unavailable rather than zero when the extension is missing", async () => {
    // Simulated: a connection whose pg_extension lookup finds nothing behaves
    // as a database without the extension.
    const fake = {
      query: async () => ({ rows: [{ ok: false }] }),
    } as unknown as Client;
    const probe = await createDbProbe(fake);
    expect(probe.available).toBe(false);
    expect((await probe.read()).statements).toBe(0);
  });
});
