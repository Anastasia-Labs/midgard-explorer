import { describe, expect, it } from "vitest";
import { decodeTransaction } from "../src/decode/transaction.js";
import { PROFILES } from "../bench/profiles.mjs";
import { generateDataset } from "../bench/generate.mjs";
import { seedDataset } from "../bench/seedShaped.mjs";
import { checksum, withThrowawayNodeDb } from "./helpers/throwawayDb.mjs";

/**
 * The load is the real invariant check.
 *
 * Every assertion above this file runs against objects the generator produced
 * and can therefore only confirm the generator agrees with itself. Here the
 * node's own CHECK constraints, primary keys, foreign keys and enum types
 * decide, and the distributions are read back out of the database by decoding
 * the stored outputs rather than by consulting the generator.
 */

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

db("seedDataset", () => {
  it("loads a whole profile, and the schema accepts every row", async () => {
    const dataset = generateDataset(PROFILES.small);
    await withThrowawayNodeDb(async (client) => {
      const report = await seedDataset(client, dataset);
      expect(report.total).toBeGreaterThan(0);
      // Every table the generator filled arrived intact.
      for (const [table, count] of Object.entries(report.inserted)) {
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM "${table}"`,
        );
        expect(Number(rows[0].n), table).toBe(count);
      }
      // ANALYZE ran, so the planner has statistics rather than defaults. A
      // dataset without them produces plans that describe an empty table.
      const { rows: stats } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stats
          WHERE schemaname = 'public' AND tablename = 'pending_block_finalizations'`,
      );
      expect(Number(stats[0].n)).toBeGreaterThan(0);
    });
  }, 180_000);

  it("the database enforces the count arithmetic we claimed to satisfy", async () => {
    const dataset = generateDataset(PROFILES.small);
    await withThrowawayNodeDb(async (client) => {
      await seedDataset(client, dataset);
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pending_block_finalizations
          WHERE expected_total_event_count <> expected_withdrawal_count
              + expected_forced_transaction_count
              + expected_l2_transaction_count
              + expected_deposit_count
             OR expected_transition_step_count <> expected_total_event_count`,
      );
      expect(Number(rows[0].n)).toBe(0);
    });
  }, 180_000);

  it("holds at most one non-terminal finalization, as the unique index requires", async () => {
    const dataset = generateDataset(PROFILES.small);
    await withThrowawayNodeDb(async (client) => {
      await seedDataset(client, dataset);
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pending_block_finalizations
          WHERE status NOT IN ('finalized', 'abandoned')`,
      );
      expect(Number(rows[0].n)).toBeLessThanOrEqual(1);
    });
  }, 180_000);

  it("stores outputs the explorer decodes into the distributions asked for", async () => {
    // Read back from the database and decode, rather than trusting the
    // generator's account of what it wrote.
    const dataset = generateDataset(PROFILES.small);
    await withThrowawayNodeDb(async (client) => {
      await seedDataset(client, dataset);
      const { rows } = await client.query<{ tx: Buffer }>(
        `SELECT tx FROM immutable WHERE octet_length(tx) < 65536 LIMIT 120`,
      );
      expect(rows.length).toBeGreaterThan(10);

      const addresses = new Map<string, number>();
      const assets = new Map<string, bigint>();
      let outputs = 0;
      let datums = 0;
      let scriptRefs = 0;
      let redeemed = 0;
      for (const row of rows) {
        const view = await decodeTransaction(row.tx);
        if (view.witnesses.redeemerCount > 0) redeemed += 1;
        for (const output of view.outputs) {
          outputs += 1;
          if (output.datum !== null) datums += 1;
          if (output.scriptRef !== null) scriptRefs += 1;
          addresses.set(output.address, (addresses.get(output.address) ?? 0) + 1);
          for (const [policy, names] of Object.entries(output.value.assets)) {
            for (const [name, quantity] of Object.entries(names)) {
              const unit = `${policy}${name}`;
              assets.set(unit, (assets.get(unit) ?? 0n) + BigInt(quantity));
            }
          }
        }
      }

      // Distinct address cardinality, and concentration on a minority.
      expect(addresses.size).toBeGreaterThan(10);
      const counts = [...addresses.values()].sort((a, b) => b - a);
      const top = counts.slice(0, Math.ceil(counts.length * 0.1));
      const share =
        top.reduce((t, n) => t + n, 0) / counts.reduce((t, n) => t + n, 0);
      expect(share).toBeGreaterThan(0.15);

      // Assets exist, carry real quantities, and are not all quantity one.
      expect(assets.size).toBeGreaterThan(0);
      expect([...assets.values()].some((q) => q > 1n)).toBe(true);

      // Rates are realized, neither zero nor everything.
      expect(datums).toBeGreaterThan(0);
      expect(datums).toBeLessThan(outputs);
      expect(scriptRefs).toBeGreaterThan(0);
      expect(redeemed).toBeGreaterThan(0);
      expect(redeemed).toBeLessThan(rows.length);
    });
  }, 180_000);

  it("keeps the oversize transactions that exercise the truncation branch", async () => {
    const dataset = generateDataset(PROFILES.small);
    await withThrowawayNodeDb(async (client) => {
      await seedDataset(client, dataset);
      const { rows } = await client.query<{ tx: Buffer }>(
        `SELECT tx FROM immutable WHERE octet_length(tx) > 65536`,
      );
      expect(rows.length).toBe(PROFILES.small.oversizeTransactions);
      const view = await decodeTransaction(rows[0].tx, undefined, {
        includeCbor: true,
      });
      // The branch the budget exists to measure.
      expect(view.cborTruncated).toBe(true);
    });
  }, 180_000);

  it("I10: two loads of the same profile produce the same database", async () => {
    const tables = ["pending_block_finalizations", "immutable", "mempool_ledger"];
    const digests: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      await withThrowawayNodeDb(async (client) => {
        await seedDataset(client, generateDataset(PROFILES.small));
        digests.push((await checksum(client, tables)).digest);
      });
    }
    expect(digests[0]).toBe(digests[1]);
  }, 300_000);
});
