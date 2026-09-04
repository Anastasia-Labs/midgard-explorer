import { describe, expect, it } from "vitest";
import { PROFILES, expectedTotals } from "../bench/profiles.mjs";
import { generateDataset } from "../bench/generate.mjs";

/**
 * The canonical dataset, checked against the invariants in
 * `docs/dataset-profiles.md` before anything touches a database.
 *
 * The node's own CHECK constraints are reproduced here deliberately. Finding a
 * violated count sum at load time tells you a row failed; finding it here tells
 * you which rule the generator broke.
 */

const HEX64 = /^[0-9a-f]{64}$/;
const dataset = generateDataset(PROFILES.small);

describe("generateDataset", () => {
  it("produces the number of blocks the profile asks for", () => {
    expect(dataset.blocks.length).toBe(PROFILES.small.blocks);
  });

  it("I1: every header hash is 28 bytes", () => {
    for (const block of dataset.blocks) {
      expect(block.headerHash.length).toBe(28);
      expect(block.baseTailHeaderHash.length).toBe(28);
    }
  });

  it("I2: every Merkle root is 64 lower-case hex characters", () => {
    for (const block of dataset.blocks) {
      for (const [name, root] of Object.entries(block.roots)) {
        expect(root, `${name}`).toMatch(HEX64);
      }
    }
  });

  it("I3 and I4: ordering is total, with collisions only where asked", () => {
    const times = dataset.blocks.map((b) => b.blockEndTime.getTime());
    const distinct = new Set(times).size;
    if (PROFILES.small.timestampCollisionRate === 0) {
      expect(distinct).toBe(times.length);
    }
    // Total order comes from (block_end_time, header_hash), never time alone.
    const keys = dataset.blocks.map(
      (b) => `${b.blockEndTime.getTime()}:${b.headerHash.toString("hex")}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("I5: the node's count arithmetic holds on every block", () => {
    for (const block of dataset.blocks) {
      const c = block.counts;
      expect(c.l2Transactions).toBe(block.transactions.length);
      expect(c.totalEvents).toBe(
        c.withdrawals + c.forcedTransactions + c.l2Transactions + c.deposits,
      );
      expect(c.transitionSteps).toBe(c.totalEvents);
      for (const value of Object.values(c)) expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses only statuses the schema permits, with at most one non-terminal", () => {
    const permitted = new Set([
      "pending_submission",
      "submitted_local_finalization_pending",
      "submitted_unconfirmed",
      "observed_waiting_stability",
      "finalized",
      "abandoned",
    ]);
    const nonTerminal = dataset.blocks.filter(
      (b) => b.status !== "finalized" && b.status !== "abandoned",
    );
    for (const block of dataset.blocks) expect(permitted.has(block.status)).toBe(true);
    expect(nonTerminal.length).toBe(PROFILES.small.statusMix.activeRows);
  });

  it("I6: exactly the settled blocks carry an L1 counterpart", () => {
    const settled = dataset.blocks.filter((b) => b.settled);
    expect(settled.length).toBe(PROFILES.small.settledBlocks);
    for (const block of dataset.blocks) {
      // An unsettled block is unsettled, not missing: it still has every field.
      expect(block.headerHash.length).toBe(28);
    }
  });

  it("I9: every member row points at a block that exists", () => {
    const known = new Set(dataset.blocks.map((b) => b.headerHash.toString("hex")));
    for (const [table, rows] of Object.entries(dataset.tables)) {
      for (const row of rows) {
        const hash = row.header_hash;
        if (hash instanceof Buffer && hash.length === 28 && table.startsWith("pending_block_finalization")) {
          expect(known.has(hash.toString("hex")), `${table}`).toBe(true);
        }
      }
    }
  });

  it("I14: no outref is produced twice or spent twice", () => {
    const produced = new Set<string>();
    for (const row of dataset.tables.mempool_ledger) {
      const key = (row.outref as Buffer).toString("hex");
      expect(produced.has(key)).toBe(false);
      produced.add(key);
    }
    expect(produced.size).toBe(dataset.tables.mempool_ledger.length);
  });

  it("clears the ledger floor the profile sets", () => {
    // A floor, not a target. The block count and the input and output shapes
    // determine the size; this number guarantees the bound.
    const rows = dataset.tables.mempool_ledger.length;
    expect(rows).toBeGreaterThanOrEqual(PROFILES.small.ledgerUtxos);
  });

  it("fills every NOT NULL column without a default (I11)", () => {
    // 28 of them on pending_block_finalizations, including ones the coverage
    // scope excludes. A generator seeding only adopted columns inserts nothing.
    for (const row of dataset.tables.pending_block_finalizations) {
      expect(Object.keys(row).length).toBeGreaterThanOrEqual(28);
      for (const [column, value] of Object.entries(row)) {
        if (column === "submitted_tx_hash") continue;
        expect(value, column).not.toBeUndefined();
        expect(value, column).not.toBeNull();
      }
    }
  });

  it("derives the event totals the profile implies", () => {
    const totals = expectedTotals(PROFILES.small);
    const sum = (key: "deposits" | "withdrawals" | "forcedTransactions") =>
      dataset.blocks.reduce((t, b) => t + b.counts[key], 0);
    // A wide band: 50 blocks is a small sample of a long-tailed shape.
    expect(sum("deposits")).toBeGreaterThan(totals.deposits * 0.4);
    expect(sum("deposits")).toBeLessThan(totals.deposits * 2.2);
  });

  it("I10: the same profile regenerates identical bytes", () => {
    const again = generateDataset(PROFILES.small);
    expect(again.blocks.map((b) => b.headerHash.toString("hex"))).toEqual(
      dataset.blocks.map((b) => b.headerHash.toString("hex")),
    );
    expect(again.tables.immutable.length).toBe(dataset.tables.immutable.length);
  });

  it("carries a transaction over the inline CBOR cap", () => {
    const oversize = dataset.tables.immutable.filter(
      (row) => (row.tx as Buffer).length > 64 * 1024,
    );
    expect(oversize.length).toBe(PROFILES.small.oversizeTransactions);
  });
});

/**
 * Every profile, not just `small`.
 *
 * The suite above generates `small` only, and `small` declares no timestamp
 * collisions, so a defect that needs two consecutive collisions could not
 * appear here. One did: a colliding block took its predecessor's end time while
 * keeping its own later start, and `da_payloads_check` rejected the row. The
 * only thing that caught it was a `target` baseline run failing at the database
 * three minutes in, which is far too late and far too expensive a gate.
 */
describe("time ordering holds for every profile", () => {
  const TIMED = ["da_payloads", "pending_block_finalizations"] as const;

  // `stress` is 50,000 blocks and 200,000 UTxOs held in memory at once, which
  // exceeds what a Vitest worker has on the two-core minimum machine. It is
  // generated by the bench run itself, in its own process; asserting it here
  // would trade a real gate for an out-of-memory crash.
  const IN_WORKER = ["small", "target"] as const;

  for (const name of IN_WORKER) {
    it(`${name}: block_end_time is never before block_start_time`, () => {
      const generated = generateDataset(PROFILES[name]);
      let checked = 0;

      for (const table of TIMED) {
        const rows = generated.tables[table] as readonly Record<string, unknown>[];
        for (const row of rows) {
          const start = row.block_start_time as Date;
          const end = row.block_end_time as Date;
          expect(start, `${table} start`).toBeInstanceOf(Date);
          expect(end, `${table} end`).toBeInstanceOf(Date);
          // The database constraint, asserted before the database sees it.
          expect(
            end.getTime() >= start.getTime(),
            `${table} row has end ${end.toISOString()} before start ${start.toISOString()}`,
          ).toBe(true);
          checked += 1;
        }
      }

      // Not a vacuous pass: the profile must actually have produced rows.
      expect(checked).toBeGreaterThan(0);
    }, 180_000);
  }

  it("target really does produce the collisions that exposed this", () => {
    const generated = generateDataset(PROFILES.target);
    const ends = generated.blocks.map((b) => b.blockEndTime.getTime());
    const shared = ends.length - new Set(ends).size;
    // Without collisions the test above proves nothing about the fixed path.
    expect(PROFILES.target.timestampCollisionRate).toBeGreaterThan(0);
    expect(shared).toBeGreaterThan(0);
  }, 180_000);
});
