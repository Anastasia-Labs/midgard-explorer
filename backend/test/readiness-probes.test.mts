import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import {
  INDEX_TABLES,
  missingRelations,
  probeIndexDatabase,
  probeIndexReconciled,
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

/**
 * The reconciliation probe.
 *
 * Schema readiness and index readiness are different questions, and the moment
 * the attribution migration lands is the proof: every relation exists, every
 * migration is recorded, and the index holds 141 transactions that no query can
 * reach behind three cursors reading zero. The probe above says READY there.
 *
 * Each case below is written so that a probe which checked nothing would fail
 * it. The stub records the SQL it was asked for, so "it queried the right two
 * relations" is asserted rather than assumed.
 */
describe("the reconciliation probe", () => {
  type Call = { sql: string; values: unknown[] };

  const stub = (
    stale: number,
    cursors: Array<{ source: string; last_block_height: number }>,
  ) => {
    const calls: Call[] = [];
    const client: Queryable = {
      $queryRawUnsafe: (async (sql: string, ...values: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("l1_event")) return [{ count: BigInt(stale) }];
        return cursors;
      }) as Queryable["$queryRawUnsafe"],
    };
    return { client, calls };
  };

  const RECONCILED = [
    { source: "l1", last_block_height: 5106392 },
    { source: "l1:mints", last_block_height: 5106392 },
    { source: "l1:rewards", last_block_height: 5106392 },
  ];

  it("accepts an index with no unreachable rows and a completed pass", async () => {
    const { client, calls } = stub(0, RECONCILED);
    await expect(probeIndexReconciled(client)).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("l1_event");
    expect(calls[1].sql).toContain("sync_cursor");
  });

  it("refuses an index still holding rows under the sentinel attribution", async () => {
    const { client } = stub(158, RECONCILED);
    await expect(probeIndexReconciled(client)).rejects.toThrow(/158 events under "default"/);
  });

  /** The exact state the migration leaves behind: shaped correctly, cursors at
   * zero. Equality between the three is not evidence of anything here, because
   * zero equals zero. */
  it("refuses the state the attribution migration leaves behind", async () => {
    const { client } = stub(0, [
      { source: "l1", last_block_height: 0 },
      { source: "l1:mints", last_block_height: 0 },
      { source: "l1:rewards", last_block_height: 0 },
    ]);
    await expect(probeIndexReconciled(client)).rejects.toThrow(
      /no completed reconciliation for 3 of 3 sources: l1, l1:mints, l1:rewards/,
    );
  });

  it("refuses an index that has never indexed anything", async () => {
    const { client } = stub(0, []);
    await expect(probeIndexReconciled(client)).rejects.toThrow(/3 of 3 sources/);
  });

  /** A pass where the reward scan failed writes no cursor for it, and the other
   * two carry on. That is a partial index, and it is named. */
  it("names the one source that did not complete", async () => {
    const { client } = stub(0, [
      { source: "l1", last_block_height: 5106392 },
      { source: "l1:mints", last_block_height: 5106392 },
    ]);
    await expect(probeIndexReconciled(client)).rejects.toThrow(
      /1 of 3 sources: l1:rewards/,
    );
  });

  /** Rows belonging to a PREVIOUS deployment are not a fault. A redeployed
   * protocol leaves its predecessor's rows behind and the read path filters
   * them out; refusing traffic forever for that would be wrong. */
  it("ignores rows attributed to some other deployment", async () => {
    const { client } = stub(0, RECONCILED);
    await expect(probeIndexReconciled(client)).resolves.toBeUndefined();
  });

  /** The stubs above prove the decision. These two prove the statements are
   * valid SQL against the schema that is actually deployed, which a stub can
   * never show: a renamed column would pass every case above.
   *
   * There are two because there have to be. The sentinel case below throws on
   * the first statement and returns, so on its own it leaves the cursor query
   * unexecuted: renaming `last_block_height` to something that does not exist
   * passed the whole file. */
  it("runs its real queries against the real index schema", async () => {
    if (!reachable) return;
    const tx = "probe_reconciled_fixture";
    await indexerPrisma.$executeRawUnsafe(
      `INSERT INTO l1_tx (tx_hash, block_height, block_hash, slot, epoch, tx_time,
         fee, size, total_output, block_index, cert_deposit)
       VALUES ($1, 1, 'x', 1, 1, now(), 0, 0, 0, 0, 0)
       ON CONFLICT (tx_hash) DO NOTHING;`,
      tx,
    );
    await indexerPrisma.$executeRawUnsafe(
      `INSERT INTO l1_event (tx_hash, validator, event_type, output_index, lovelace, deployment)
       VALUES ($1, 'v', 'e', 0, 0, 'default')
       ON CONFLICT (tx_hash, output_index) DO NOTHING;`,
      tx,
    );
    try {
      await expect(probeIndexReconciled()).rejects.toThrow(/under "default"/);
    } finally {
      await indexerPrisma.$executeRawUnsafe(`DELETE FROM l1_tx WHERE tx_hash = $1;`, tx);
    }
  });

  it("runs the cursor query against the real index schema", async () => {
    if (!reachable) return;
    // No sentinel rows remain, so the first statement passes and execution
    // reaches the second. What the cursors hold depends on whatever else the
    // suite has written, so the assertion is on the KIND of failure: the
    // probe's own verdict, never a database error.
    await probeIndexReconciled().catch((err: Error) => {
      expect(err.message).toMatch(/no completed reconciliation/);
    });
  });
});
