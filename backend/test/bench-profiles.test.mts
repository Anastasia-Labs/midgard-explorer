import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  MAX_INLINE_CBOR_BYTES,
  PROFILES,
  expectedTotals,
  REAL_SETTLED_BLOCKS,
  SCAN_LIMIT,
  type Profile,
  type Shape,
} from "../bench/profiles.mjs";

/**
 * The profiles encode the invariants in `docs/dataset-profiles.md`. Each
 * assertion here corresponds to one, because a generator that silently violates
 * an invariant produces a benchmark that measures the wrong thing and still
 * reports a number.
 *
 * The schema-derived assertions matter most: a profile the database would
 * refuse to hold is not a specification, and the failure surfaces at seed time
 * rather than at review time.
 */

const all = Object.values(PROFILES) as Profile[];

/** Every status the node's check constraint permits. */
const TERMINAL = ["finalized", "abandoned"];
const NON_TERMINAL = [
  "pending_submission",
  "submitted_local_finalization_pending",
  "submitted_unconfirmed",
  "observed_waiting_stability",
];

function monotonic(s: Shape): boolean {
  return s.p50 <= s.p95 && s.p95 <= s.p99 && s.p99 <= s.max;
}

describe("PROFILES", () => {
  it("declares the three profiles the spec names", () => {
    expect(Object.keys(PROFILES).sort()).toEqual(["small", "stress", "target"]);
  });

  it("I1: header hashes are 28 bytes, matching isHash28", () => {
    for (const p of all) expect(p.headerHashBytes, p.name).toBe(28);
  });

  it("I2: Merkle roots are 64 hex characters, 32 bytes, in a text column", () => {
    for (const p of all) expect(p.rootHexLength, p.name).toBe(64);
  });

  it("I4: target and stress collide timestamps; small mirrors live and does not", () => {
    // I4 is scoped to the profiles that exercise ordering. BYTEA-ORDERING's
    // correctness test runs on target or stress, never on small, because live
    // data has no collisions and small exists to mirror live data.
    expect(PROFILES.target.timestampCollisionRate).toBeGreaterThan(0);
    expect(PROFILES.stress.timestampCollisionRate).toBeGreaterThan(0);
    expect(PROFILES.small.timestampCollisionRate).toBe(0);
  });

  it("uses only statuses the node's check constraint permits", () => {
    for (const p of all) {
      if (p.statusMix.activeState !== null) {
        expect(NON_TERMINAL, p.name).toContain(p.statusMix.activeState);
      }
    }
    // `failed` was never a status in this schema. Guard against it returning.
    const source = JSON.stringify(PROFILES);
    expect(source).not.toContain("failed");
    expect(TERMINAL).toContain("abandoned");
  });

  it("respects uniq_pending_block_finalizations_single_active: at most one non-terminal row", () => {
    // A UNIQUE index on the constant (1) with a partial predicate over the four
    // non-terminal states permits exactly one such row in the whole table. A
    // fractional "6% pending" is not merely wrong, it is uninsertable.
    for (const p of all) {
      expect(p.statusMix.activeRows, p.name).toBeLessThanOrEqual(1);
      if (p.statusMix.activeRows === 0) {
        expect(p.statusMix.activeState, p.name).toBeNull();
      } else {
        expect(p.statusMix.activeState, p.name).not.toBeNull();
      }
    }
  });

  it("splits the terminal rows into a distribution that sums to one", () => {
    for (const p of all) {
      const total = p.statusMix.finalized + p.statusMix.abandoned;
      expect(total, p.name).toBeCloseTo(1, 5);
    }
  });

  it("carries the approved empty-block rates, small mirroring and target challenging", () => {
    expect(PROFILES.small.emptyBlockRate).toBeCloseTo(0.78, 2);
    expect(PROFILES.target.emptyBlockRate).toBeCloseTo(0.3, 2);
  });

  it("gives target enough blocks for the deepest paginated workload", () => {
    expect(PROFILES.target.blocks).toBeGreaterThanOrEqual(2_500);
  });

  it("sizes the ledger to actually cross SCAN_LIMIT where truncation is claimed", () => {
    // `getSpendableLedger` reports `truncated: total > rows.length`. At exactly
    // SCAN_LIMIT the two are equal, so the truncation path is never taken.
    for (const p of all) {
      if (p.ledgerTruncates) {
        expect(p.ledgerUtxos, p.name).toBeGreaterThan(SCAN_LIMIT);
      } else {
        expect(p.ledgerUtxos, p.name).toBeLessThanOrEqual(SCAN_LIMIT);
      }
    }
    expect(PROFILES.target.ledgerTruncates).toBe(true);
  });

  it("I6: cross-source agreement is scoped to the blocks the real L1 snapshot can settle", () => {
    // The index snapshot holds 9 real l1_block_header rows. Requiring all 5,000
    // generated blocks to have a settled counterpart is impossible; requiring
    // the 9 is both possible and exercises the settled render path, while the
    // rest exercise the unsettled one.
    for (const p of all) {
      expect(p.settledBlocks, p.name).toBe(REAL_SETTLED_BLOCKS);
      expect(p.settledBlocks, p.name).toBeLessThanOrEqual(p.blocks);
    }
  });

  it("specifies every distribution a generator needs, so two implementations agree", () => {
    // Without these, two generators satisfying the same profile produce
    // materially different workloads and both report a pass.
    for (const p of all) {
      for (const [field, shape] of [
        ["txsPerBlock", p.txsPerBlock],
        ["inputsPerTx", p.inputsPerTx],
        ["outputsPerTx", p.outputsPerTx],
        ["assetsPerOutput", p.assetsPerOutput],
        ["depositsPerBlock", p.depositsPerBlock],
        ["withdrawalsPerBlock", p.withdrawalsPerBlock],
        ["forcedPerBlock", p.forcedPerBlock],
        ["txBodyBytes", p.txBodyBytes],
        ["headerCborBytes", p.headerCborBytes],
      ] as const) {
        expect(monotonic(shape), `${p.name}.${field}`).toBe(true);
      }
      expect(p.addresses, p.name).toBeGreaterThan(0);
      expect(p.assets, p.name).toBeGreaterThan(0);
      const search =
        p.searchMix.uniqueHit + p.searchMix.multiHit + p.searchMix.miss;
      expect(search, p.name).toBeCloseTo(1, 5);
      expect(p.searchMix.miss, p.name).toBeGreaterThan(0);
    }
  });

  it("I10: profiles are deterministic, carrying an explicit seed", () => {
    for (const p of all) expect(typeof p.seed, p.name).toBe("number");
    const seeds = all.map((p) => p.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("orders the profiles strictly by size", () => {
    expect(PROFILES.small.blocks).toBeLessThan(PROFILES.target.blocks);
    expect(PROFILES.target.blocks).toBeLessThan(PROFILES.stress.blocks);
  });

  it("marks every assumption-derived field as such, so no reader mistakes it for measurement", () => {
    for (const p of all) {
      expect(Array.isArray(p.assumptions), p.name).toBe(true);
      expect(p.assumptions.length, p.name).toBeGreaterThan(0);
    }
  });

  it("carries transactions that actually exceed MAX_INLINE_CBOR_BYTES", () => {
    // `decode/transaction.ts:512` sets cborTruncated on
    // `txBytes.length > MAX_INLINE_CBOR_BYTES`, so 64 KB exactly does not
    // truncate. The structure shapes top out near 6 KB, so the oversize count
    // is the only thing that reaches the cap, and the stated max must clear it.
    for (const p of all) {
      expect(p.oversizeTransactions, p.name).toBeGreaterThan(0);
      expect(p.txBodyBytes.max, p.name).toBeGreaterThan(MAX_INLINE_CBOR_BYTES);
    }
  });

  it("derives dataset totals from the shapes rather than declaring them twice", () => {
    // The defect this replaces: the profile stated both per-block shapes and
    // dataset totals, and they disagreed by 1.85x on deposits and 2.31x on
    // withdrawals. A generator cannot honour both, so it would have silently
    // broken whichever it checked second.
    const totals = expectedTotals(PROFILES.target);
    expect(totals.deposits).toBe(3_700);
    expect(totals.withdrawals).toBe(1_850);
    expect(totals.forcedTransactions).toBe(250);
    for (const p of all) {
      const t = expectedTotals(p);
      expect(t.deposits, p.name).toBeGreaterThan(0);
      expect(t.withdrawals, p.name).toBeGreaterThan(0);
    }
  });

  it("specifies the distributions the heavy read paths depend on", () => {
    // Each of these drives a workload that would otherwise measure a trivial
    // case: uniform addresses make address-history a one-row page, flat asset
    // holders make the asset roster uniform, and no admission mix leaves the
    // metrics panel counting one status.
    for (const p of all) {
      expect(p.addressSkew, p.name).toBeGreaterThan(0);
      expect(p.assetHolderSkew, p.name).toBeGreaterThan(0);
      expect(p.assetQuantity.max, p.name).toBeGreaterThan(p.assetQuantity.p50);
      expect(p.datumRate, p.name).toBeGreaterThan(0);
      expect(p.scriptRefRate, p.name).toBeGreaterThan(0);
      expect(p.redeemerRate, p.name).toBeGreaterThan(0);
      expect(p.eventPayloadBytes.p50, p.name).toBeGreaterThan(0);
      const admission =
        p.admissionMix.queued +
        p.admissionMix.validating +
        p.admissionMix.accepted +
        p.admissionMix.rejected;
      expect(admission, p.name).toBeCloseTo(1, 5);
      // Both live states must appear, or the lease constraints are never
      // exercised, and both terminal states, or `terminal_at` never is.
      expect(p.admissionMix.validating, p.name).toBeGreaterThan(0);
      expect(p.admissionMix.rejected, p.name).toBeGreaterThan(0);
    }
  });

  it("matches the numbers stated in the specification", async () => {
    const spec = await readFile("../docs/dataset-profiles.md", "utf8");
    expect(spec).toContain(PROFILES.target.blocks.toLocaleString("en-US"));
    expect(spec).toContain(PROFILES.stress.blocks.toLocaleString("en-US"));
    expect(spec).toContain(PROFILES.target.ledgerUtxos.toLocaleString("en-US"));
    // The derived totals, so prose and code cannot drift apart again.
    const totals = expectedTotals(PROFILES.target);
    expect(spec).toContain(totals.deposits.toLocaleString("en-US"));
    expect(spec).toContain(totals.withdrawals.toLocaleString("en-US"));
    // The corrected status vocabulary must be in the spec, not just the code.
    expect(spec).toContain("abandoned");
    expect(spec).not.toContain("finalized / pending / failed");
  });
});
