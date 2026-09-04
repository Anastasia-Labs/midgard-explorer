/**
 * Dataset profiles, specified in `docs/dataset-profiles.md`.
 *
 * Three profiles answering three questions: does the read path work (`small`),
 * does it meet its budget at a plausible production size (`target`), and does
 * it degrade rather than fall over (`stress`).
 *
 * Every distribution here that is not measured is listed in `assumptions`, and
 * the specification names an owner for each. The live node holds nine blocks
 * and two transactions, which cannot yield a distribution, so a number without
 * a citation is an engineering estimate and must read as one.
 */

export type StatusMix = {
  finalized: number;
  pending: number;
  failed: number;
};

/** Percentile shape, in bytes or count depending on the field. */
export type Shape = {
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

export type Profile = {
  name: "small" | "target" | "stress";
  /** What question this profile answers. */
  question: string;
  blocks: number;
  txsPerBlock: Shape;
  /** Fraction of blocks containing no transactions. */
  emptyBlockRate: number;
  statusMix: StatusMix;
  /** Fraction of blocks sharing a `block_end_time` with at least one other. */
  timestampCollisionRate: number;
  ledgerUtxos: number;
  deposits: number;
  withdrawals: number;
  forcedTransactions: number;
  txBodyBytes: Shape;
  headerCborBytes: Shape;
  /** I1: 28, not 32. `utils.ts:15` sets HASH28_HEX = 56. */
  headerHashBytes: 28;
  /** I2: roots are 32-byte values in a `text` column, already hex. */
  rootHexLength: 64;
  /** I10: same profile, same bytes. */
  seed: number;
  /** Fields whose distribution is an estimate rather than an observation. */
  assumptions: readonly string[];
};

const MEASURED_TX_BODY_P50 = 383; // live `immutable`, n=2
const MEASURED_HEADER_CBOR_P50 = 361; // live `pending_block_finalizations`, n=9

export const PROFILES = {
  /**
   * Mirrors observed reality rather than challenging it. 78% empty matches the
   * live node exactly: seven of its nine finalized blocks contain no
   * transactions. The pessimistic bias lives in `target`, not here.
   */
  small: {
    name: "small",
    question: "does the read path work",
    blocks: 50,
    txsPerBlock: { p50: 0, p95: 3, p99: 5, max: 5 },
    emptyBlockRate: 0.78,
    statusMix: { finalized: 1, pending: 0, failed: 0 },
    timestampCollisionRate: 0,
    ledgerUtxos: 200,
    deposits: 20,
    withdrawals: 10,
    forcedTransactions: 5,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 800, p99: 1_200, max: 2_048 },
    headerCborBytes: { p50: MEASURED_HEADER_CBOR_P50, p95: 512, p99: 700, max: 1_024 },
    headerHashBytes: 28,
    rootHexLength: 64,
    seed: 1,
    assumptions: ["txsPerBlock tail", "txBodyBytes tail", "headerCborBytes tail"],
  },

  /**
   * The profile every approved budget is measured against.
   *
   * 5,000 blocks is derived from a requirement, not a forecast:
   * `blocks-list-page-deep` requests page 100, which at 25 rows per page needs
   * 2,500 rows to exist. Below that the budget measures an empty page and
   * reports a pass.
   *
   * 30% empty is APPROVED as a pessimistic challenge profile (2026-09-04). The
   * live rate is 78%; 30% is deliberately harsher, because a mostly-empty list
   * page is cheap and would hide the cost these budgets exist to catch. It is a
   * test-design choice and must never be cited as a production observation.
   */
  target: {
    name: "target",
    question: "does it meet its budget at a plausible production size",
    blocks: 5_000,
    txsPerBlock: { p50: 1, p95: 20, p99: 60, max: 200 },
    emptyBlockRate: 0.3,
    statusMix: { finalized: 0.92, pending: 0.06, failed: 0.02 },
    timestampCollisionRate: 0.05,
    ledgerUtxos: 20_000,
    deposits: 2_000,
    withdrawals: 800,
    forcedTransactions: 300,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 2_048, p99: 8_192, max: 65_536 },
    headerCborBytes: { p50: MEASURED_HEADER_CBOR_P50, p95: 1_024, p99: 2_048, max: 4_096 },
    headerHashBytes: 28,
    rootHexLength: 64,
    seed: 2,
    assumptions: [
      "txsPerBlock distribution: live data has 2 transactions across 9 blocks",
      "statusMix 92/6/2: live data is 100% finalized",
      "txBodyBytes tail: p50 measured, p95/p99/max estimated",
      "headerCborBytes tail: p50 measured, tail estimated",
    ],
  },

  /**
   * A shape check, not a pass/fail profile. Answers whether the system degrades
   * gracefully rather than falling over.
   */
  stress: {
    name: "stress",
    question: "does it degrade gracefully rather than fall over",
    blocks: 50_000,
    txsPerBlock: { p50: 1, p95: 20, p99: 60, max: 500 },
    emptyBlockRate: 0.3,
    statusMix: { finalized: 0.92, pending: 0.06, failed: 0.02 },
    timestampCollisionRate: 0.05,
    ledgerUtxos: 200_000,
    deposits: 20_000,
    withdrawals: 8_000,
    forcedTransactions: 3_000,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 2_048, p99: 8_192, max: 65_536 },
    headerCborBytes: { p50: MEASURED_HEADER_CBOR_P50, p95: 1_024, p99: 2_048, max: 4_096 },
    headerHashBytes: 28,
    rootHexLength: 64,
    seed: 3,
    assumptions: [
      "txsPerBlock distribution, extended to max 500",
      "statusMix 92/6/2",
      "txBodyBytes tail",
      "headerCborBytes tail",
    ],
  },
} as const satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;
