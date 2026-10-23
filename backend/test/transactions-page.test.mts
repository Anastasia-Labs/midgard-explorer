import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client/index.js";
import { PROFILES, type Profile } from "../bench/profiles.mjs";
import { generateDataset } from "../bench/generate.mjs";
import { seedDataset } from "../bench/seedShaped.mjs";
import { transactionsPageRows, type TransactionPageRow } from "../src/db/transaction.js";
import { adminUrl, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";

/**
 * A transactions page sorts on keys and reads the transaction bytes for its own
 * rows only. Sorting with the bytes attached spilled to disk on a deep page at
 * `target`. Every page, under every status filter, must read back exactly as
 * the one-pass query did, including past the last page and on blocks whose end
 * times collide.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

/** Small enough to seed quickly, with the collisions and statuses `small` lacks. */
const PROFILE: Profile = {
  ...PROFILES.small,
  blocks: 240,
  emptyBlockRate: 0.2,
  timestampCollisionRate: 0.2,
  statusMix: {
    finalized: 0.9,
    abandoned: 0.1,
    activeRows: 1,
    activeState: "submitted_unconfirmed",
  },
  seed: 7,
};

/** A short page, so the chain spans many of them and the last one is partial. */
const LIMIT = 7;

/** The page as one pass: sort with every column attached, then cut. */
const onePass = (reader: PrismaClient, offset: number, filter: string | null) =>
  reader.$queryRaw<TransactionPageRow[]>`WITH legacy AS (
      SELECT header_hash, MIN(height)::int AS height FROM blocks GROUP BY header_hash
    )
    SELECT l.height,
      j.header_hash,
      j.member_id AS tx_id,
      j.source_time_stamp_tz AS time_stamp_tz,
      j.payload_cbor AS tx,
      f.status AS finalization_status
    FROM pending_block_finalization_txs AS j
    JOIN pending_block_finalizations AS f ON f.header_hash = j.header_hash
    LEFT JOIN legacy AS l ON l.header_hash = j.header_hash
    WHERE ${filter}::text IS NULL OR f.status = ${filter}
    ORDER BY f.block_end_time DESC, encode(f.header_hash, 'hex') DESC,
             j.ordinal ASC
    OFFSET ${offset}
    LIMIT ${LIMIT};`;

db("transactionsPageRows", () => {
  it("returns every page exactly as the one-pass sort did", async () => {
    await withThrowawayNodeDb(async (client) => {
      await seedDataset(client, generateDataset(PROFILE));
      const { rows: named } = await client.query<{ name: string }>(
        `SELECT current_database() AS name`,
      );
      const reader = new PrismaClient({
        adapter: new PrismaPg({ connectionString: adminUrl(named[0].name) }),
      });
      try {
        const { rows: collisions } = await client.query<{ n: string }>(`
          SELECT count(*)::text AS n FROM (
            SELECT block_end_time FROM pending_block_finalizations
             GROUP BY block_end_time HAVING count(*) > 1) c`);
        // The tiebreak is only exercised if end times actually collide.
        expect(Number(collisions[0].n)).toBeGreaterThan(0);

        let compared = 0;
        const statuses = [null, "finalized", "abandoned", "submitted_unconfirmed", "pending_submission"];
        for (const filter of statuses) {
          const { rows: counted } = await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM pending_block_finalization_txs j
               JOIN pending_block_finalizations f ON f.header_hash = j.header_hash
              WHERE $1::text IS NULL OR f.status = $1`,
            [filter],
          );
          const pages = Math.ceil(Number(counted[0].n) / LIMIT);
          for (let page = 1; page <= pages + 1; page += 1) {
            const offset = (page - 1) * LIMIT;
            const expected = await onePass(reader, offset, filter);
            expect(await transactionsPageRows(reader, offset, LIMIT, filter), `${filter} page ${page}`)
              .toEqual(expected);
            compared += expected.length;
          }
        }
        expect(compared).toBeGreaterThan(LIMIT * 20);
      } finally {
        await reader.$disconnect();
      }
    });
  }, 180_000);
});
