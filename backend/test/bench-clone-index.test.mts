import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { PROFILES } from "../bench/profiles.mjs";
import { generateDataset } from "../bench/generate.mjs";
import { cloneIndex, INDEX_TABLES } from "../bench/cloneIndex.mjs";
import {
  createDatabase,
  dropDatabase,
  isMarkedThrowaway,
} from "./helpers/throwawayDb.mjs";

/**
 * The frozen L1 snapshot.
 *
 * L1 data is real and must never be synthesized, and the live index must never
 * be benchmarked against: a moving source makes two runs incomparable, and a
 * write would corrupt the only real data the explorer holds. So the clone is
 * taken into a harness-created throwaway, checksummed, and read from there.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
// The live explorer index. Read-only here; the clone never writes to it.
const INDEX_URL = process.env.INDEXER_POSTGRES_URL;
const db = REQUIRE_DB && INDEX_URL ? describe : describe.skip;

db("cloneIndex", () => {
  it("copies the live index into a marked throwaway and checksums it", async () => {
    const source = new Client({ connectionString: INDEX_URL });
    await source.connect();
    const name = await createDatabase();
    const targetUrl = new URL(process.env.POSTGRES_URL!);
    targetUrl.pathname = `/${name}`;
    const target = new Client({ connectionString: targetUrl.toString() });
    try {
      await target.connect();
      expect(await isMarkedThrowaway(name)).toBe(true);

      const snapshot = await cloneIndex(source, target);

      // Row counts match the live index exactly, table by table.
      for (const table of INDEX_TABLES) {
        const live = await source.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM "${table}"`,
        );
        expect(snapshot.checksum.tables[table], table).toBe(Number(live.rows[0].n));
      }
      expect(snapshot.checksum.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshot.checksum.rows).toBeGreaterThan(0);

      // The real L2 header hashes, 28 bytes each, from the MBLC token.
      for (const hash of snapshot.settledHashes) {
        expect(hash.length).toBe(28);
      }
      expect(new Set(snapshot.settledHashes.map((h) => h.toString("hex"))).size)
        .toBe(snapshot.settledHashes.length);

      // A generated dataset settles its blocks against those real hashes, so
      // I6 is an agreement with real data rather than a shape check.
      if (snapshot.settledHashes.length > 0) {
        const dataset = generateDataset(PROFILES.small, {
          settledHashes: snapshot.settledHashes,
        });
        const settled = dataset.blocks.filter((b) => b.settled);
        const real = new Set(snapshot.settledHashes.map((h) => h.toString("hex")));
        const used = settled
          .map((b) => b.headerHash.toString("hex"))
          .filter((h) => real.has(h));
        expect(used.length).toBe(
          Math.min(settled.length, snapshot.settledHashes.length),
        );
      }
    } finally {
      await target.end().catch(() => {});
      await source.end().catch(() => {});
      await dropDatabase(name);
    }
  }, 300_000);

  it("leaves the live index untouched", async () => {
    // The clone reads with SELECT only. This checks the live row counts are
    // the same before and after, which is the property that matters.
    const source = new Client({ connectionString: INDEX_URL });
    await source.connect();
    const before = await source.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM l1_tx`,
    );
    const name = await createDatabase();
    const targetUrl = new URL(process.env.POSTGRES_URL!);
    targetUrl.pathname = `/${name}`;
    const target = new Client({ connectionString: targetUrl.toString() });
    try {
      await target.connect();
      await cloneIndex(source, target);
      const after = await source.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM l1_tx`,
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    } finally {
      await target.end().catch(() => {});
      await source.end().catch(() => {});
      await dropDatabase(name);
    }
  }, 300_000);
});
