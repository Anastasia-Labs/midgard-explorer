import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client/index.js";
import { PROFILES } from "../bench/profiles.mjs";
import { generateDataset } from "../bench/generate.mjs";
import { seedDataset } from "../bench/seedShaped.mjs";
import {
  getBlockDaMetadata,
  getBlockEvents,
  getBlockFinalization,
  getBlockSummary,
  type BlockEventMember,
  type BlockHeaderRecord,
} from "../src/db/block.js";
import { adminUrl, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";

/**
 * The block page reads its header, DA metadata, finalization and events in two
 * statements where it used six. Fewer round trips are only worth having if
 * every block reads back exactly as before, so each merged read is compared
 * with the form it replaced, over a generated chain plus the three shapes the
 * generator never produces: a DA payload with no journal row, a journal row
 * whose payload is gone, and a legacy block with neither.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

/** The header query before it was narrowed to the key: both tables joined whole. */
const wholeTableHeader = (reader: PrismaClient, key: Buffer) =>
  reader.$queryRaw<BlockHeaderRecord[]>`
    WITH materialized AS (
      SELECT header_hash, MIN(height)::int AS height, COUNT(*)::bigint AS count,
             MAX(time_stamp_tz) AS block_end_time
        FROM blocks WHERE header_hash = ${key} GROUP BY header_hash
    )
    SELECT COALESCE(f.header_hash, d.header_hash, b.header_hash) AS header_hash,
           b.height,
           COALESCE(f.block_start_time, d.block_start_time) AS block_start_time,
           COALESCE(f.block_end_time, d.block_end_time, b.block_end_time) AS block_end_time,
           COALESCE(f.expected_l2_transaction_count, d.l2_transaction_count) AS header_l2_transaction_count,
           COALESCE(f.expected_deposit_count, d.deposit_count) AS header_deposit_count,
           COALESCE(f.expected_withdrawal_count, d.withdrawal_count) AS header_withdrawal_count,
           COALESCE(f.expected_forced_transaction_count, d.forced_transaction_count) AS header_forced_transaction_count,
           COALESCE(b.count, 0)::bigint AS materialized_l2_transaction_count,
           (d.header_hash IS NOT NULL) AS payload_retained_locally
      FROM pending_block_finalizations AS f
      FULL OUTER JOIN da_payloads AS d ON d.header_hash = f.header_hash
      FULL OUTER JOIN materialized AS b
        ON b.header_hash = COALESCE(f.header_hash, d.header_hash)
     WHERE COALESCE(f.header_hash, d.header_hash, b.header_hash) = ${key};`;

/** The events as three statements, one per table. */
const perTableEvents = async (reader: PrismaClient, key: Buffer) => {
  const [deposits, withdrawals, forcedTransactions] = await Promise.all([
    reader.$queryRaw<BlockEventMember[]>`
      SELECT member_id, ordinal, source_time_stamp_tz
        FROM pending_block_finalization_deposits
       WHERE header_hash = ${key} ORDER BY ordinal ASC;`,
    reader.$queryRaw<BlockEventMember[]>`
      SELECT member_id, ordinal, source_time_stamp_tz
        FROM pending_block_finalization_withdrawals
       WHERE header_hash = ${key} ORDER BY ordinal ASC;`,
    reader.$queryRaw<BlockEventMember[]>`
      SELECT member_id, ordinal, source_time_stamp_tz
        FROM pending_block_finalization_forced_transactions
       WHERE header_hash = ${key} ORDER BY ordinal ASC;`,
  ]);
  return { deposits, withdrawals, forcedTransactions };
};

db("the merged block reads", () => {
  it("read back every block exactly as the separate statements did", async () => {
    await withThrowawayNodeDb(async (client) => {
      await seedDataset(client, generateDataset(PROFILES.small));
      await client.query(`
        DELETE FROM da_payloads WHERE header_hash = (
          SELECT header_hash FROM pending_block_finalizations
           ORDER BY block_end_time LIMIT 1);
        INSERT INTO da_payloads
        SELECT (jsonb_populate_record(NULL::da_payloads, to_jsonb(d)
                 || jsonb_build_object('header_hash', '\\x' || repeat('d1', 28)))).*
          FROM da_payloads d LIMIT 1;
        INSERT INTO blocks (height, header_hash, tx_id, time_stamp_tz)
        SELECT COALESCE(max(height), 0) + 1, decode(repeat('b1', 28), 'hex'),
               decode(repeat('ee', 32), 'hex'), '2026-01-01 00:00:00'
          FROM blocks;`);

      const { rows: named } = await client.query<{ name: string }>(
        `SELECT current_database() AS name`,
      );
      const reader = new PrismaClient({
        adapter: new PrismaPg({ connectionString: adminUrl(named[0].name) }),
      });
      try {
        const { rows } = await client.query<{ hash: string }>(`
          SELECT encode(h, 'hex') AS hash FROM (
            SELECT header_hash AS h FROM pending_block_finalizations
            UNION SELECT header_hash FROM da_payloads
            UNION SELECT header_hash FROM blocks) u`);
        const hashes = [...rows.map((r) => r.hash), "00".repeat(28)];
        expect(hashes).toContain("d1".repeat(28));
        expect(hashes).toContain("b1".repeat(28));

        const shapes = new Set<string>();
        let events = 0;
        for (const hash of hashes) {
          const key = Buffer.from(hash, "hex");
          const summary = await getBlockSummary(hash, reader);
          expect(summary.header, hash).toEqual(
            (await wholeTableHeader(reader, key))[0] ?? null,
          );
          expect(summary.da, hash).toEqual(await getBlockDaMetadata(hash, reader));
          expect(summary.finalization, hash).toEqual(
            await getBlockFinalization(hash, reader),
          );
          const merged = await getBlockEvents(hash, reader);
          expect(merged, hash).toEqual(await perTableEvents(reader, key));
          events +=
            merged.deposits.length +
            merged.withdrawals.length +
            merged.forcedTransactions.length;
          shapes.add(
            `${summary.header !== null}/${summary.da !== null}/${summary.finalization !== null}`,
          );
        }
        // Every branch of the outer joins was taken, and events were compared
        // rather than a run of empty lists.
        expect([...shapes].sort()).toEqual(
          ["false/false/false", "true/false/false", "true/false/true", "true/true/false", "true/true/true"],
        );
        expect(events).toBeGreaterThan(0);
      } finally {
        await reader.$disconnect();
      }
    });
  }, 180_000);
});
