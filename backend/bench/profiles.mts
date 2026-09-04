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
 *
 * Every field is constrained by the real node DDL in
 * `test/fixtures/schema/midgard-node.sql`. A profile that a generator cannot
 * insert is not a profile, so the schema constraints are encoded here rather
 * than discovered at seed time.
 */

/** The four non-terminal states in `pending_block_finalizations_status_check`. */
export type PendingState =
  | "pending_submission"
  | "submitted_local_finalization_pending"
  | "submitted_unconfirmed"
  | "observed_waiting_stability";

/**
 * Block status distribution.
 *
 * `failed` is not a status. The schema's check constraint permits exactly
 * `pending_submission`, `submitted_local_finalization_pending`,
 * `submitted_unconfirmed`, `observed_waiting_stability`, `finalized` and
 * `abandoned`.
 *
 * And the non-terminal states are not a percentage of anything.
 * `uniq_pending_block_finalizations_single_active` is a UNIQUE index on the
 * constant `(1)` with a partial predicate over those four states, which permits
 * **at most one such row in the whole table**. A profile asking for 6% pending
 * at 5,000 blocks is asking for 300 rows the database will refuse to hold.
 */
export type StatusMix = {
  /** Share of the terminal rows in `finalized`. */
  finalized: number;
  /** Share of the terminal rows in `abandoned`. */
  abandoned: number;
  /** Non-terminal rows. Schema-capped at 1. */
  activeRows: 0 | 1;
  /** Which state that row occupies. `null` only when `activeRows` is 0. */
  activeState: PendingState | null;
};

/** Percentile shape, in bytes or count depending on the field. */
export type Shape = {
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

/**
 * The mix of search terms the search workload issues.
 *
 * Without this, two generators satisfying the same profile produce search
 * benchmarks that differ by an order of magnitude: an all-miss mix measures the
 * index scan and never the result assembly.
 */
export type SearchMix = {
  /** Prefixes matching exactly one entity. */
  uniqueHit: number;
  /** Prefixes matching many, exercising the result cap. */
  multiHit: number;
  /** Well-formed prefixes matching nothing. */
  miss: number;
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
  /**
   * Whether `getSpendableLedger` truncates on this profile.
   *
   * `asset.ts:47` computes `truncated: total > rows.length` against
   * `SCAN_LIMIT = 20_000`. At exactly 20,000 the two are equal, so the
   * truncation path is never taken and `asset-roster` measures the easy case.
   */
  ledgerTruncates: boolean;
  /** Per-block event counts. The totals below are derived from these. */
  depositsPerBlock: Shape;
  withdrawalsPerBlock: Shape;
  forcedPerBlock: Shape;
  /** Target totals. The generator matches the shapes and lands within 5%. */
  deposits: number;
  withdrawals: number;
  forcedTransactions: number;
  inputsPerTx: Shape;
  outputsPerTx: Shape;
  /** Native assets on one output, over and above ada. */
  assetsPerOutput: Shape;
  /** Distinct L2 addresses across the dataset. */
  addresses: number;
  /** Distinct native assets (policy plus name) across the dataset. */
  assets: number;
  searchMix: SearchMix;
  /**
   * I6: blocks that also exist in the real L1 index snapshot.
   *
   * The snapshot holds 9 real `l1_block_header` rows, so at most 9 generated
   * blocks can carry a real settlement counterpart. Every other block is
   * legitimately unsettled, which is a state the routes must render as such.
   */
  settledBlocks: number;
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

/** `l1_block_header` rows in the real explorer index, measured 2026-09-04. */
export const REAL_SETTLED_BLOCKS = 9;

/** Mirrors `SCAN_LIMIT` in `src/db/asset.ts`. */
export const SCAN_LIMIT = 20_000;

export const PROFILES = {
  /**
   * Mirrors observed reality rather than challenging it. 78% empty matches the
   * live node exactly: seven of its nine finalized blocks contain no
   * transactions. The pessimistic bias lives in `target`, not here.
   *
   * No active finalization, because the live node has none: all 9 of its rows
   * are terminal. And no timestamp collisions, so this profile does not
   * exercise the ordering tiebreak. `target` and `stress` do.
   */
  small: {
    name: "small",
    question: "does the read path work",
    blocks: 50,
    txsPerBlock: { p50: 0, p95: 3, p99: 5, max: 5 },
    emptyBlockRate: 0.78,
    statusMix: { finalized: 1, abandoned: 0, activeRows: 0, activeState: null },
    timestampCollisionRate: 0,
    ledgerUtxos: 200,
    ledgerTruncates: false,
    depositsPerBlock: { p50: 0, p95: 2, p99: 3, max: 4 },
    withdrawalsPerBlock: { p50: 0, p95: 1, p99: 2, max: 2 },
    forcedPerBlock: { p50: 0, p95: 1, p99: 1, max: 1 },
    deposits: 20,
    withdrawals: 10,
    forcedTransactions: 5,
    inputsPerTx: { p50: 1, p95: 3, p99: 4, max: 5 },
    outputsPerTx: { p50: 2, p95: 4, p99: 5, max: 6 },
    assetsPerOutput: { p50: 0, p95: 1, p99: 2, max: 3 },
    addresses: 40,
    assets: 8,
    searchMix: { uniqueHit: 0.5, multiHit: 0.25, miss: 0.25 },
    settledBlocks: REAL_SETTLED_BLOCKS,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 800, p99: 1_200, max: 2_048 },
    headerCborBytes: { p50: MEASURED_HEADER_CBOR_P50, p95: 512, p99: 700, max: 1_024 },
    headerHashBytes: 28,
    rootHexLength: 64,
    seed: 1,
    assumptions: [
      "txsPerBlock tail",
      "txBodyBytes tail",
      "headerCborBytes tail",
      "inputsPerTx / outputsPerTx / assetsPerOutput: no live transaction graph to measure",
      "searchMix: chosen so every branch of the search path is exercised",
    ],
  },

  /**
   * The profile every approved budget is measured against.
   *
   * 5,000 blocks is derived from a requirement, not a forecast:
   * `blocks-list-page-deep` requests page 100, which at 25 rows per page needs
   * 2,500 rows to exist. Below that the budget measures an empty page and
   * reports a pass. Approved 2026-09-04 as benchmark headroom, explicitly not
   * as a production forecast.
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
    statusMix: {
      finalized: 0.98,
      abandoned: 0.02,
      activeRows: 1,
      activeState: "submitted_unconfirmed",
    },
    timestampCollisionRate: 0.05,
    // Above SCAN_LIMIT on purpose, so `truncated` is true and the partial
    // coverage path is what `asset-roster` measures.
    ledgerUtxos: 25_000,
    ledgerTruncates: true,
    depositsPerBlock: { p50: 0, p95: 2, p99: 6, max: 20 },
    withdrawalsPerBlock: { p50: 0, p95: 1, p99: 3, max: 10 },
    forcedPerBlock: { p50: 0, p95: 0, p99: 1, max: 5 },
    deposits: 2_000,
    withdrawals: 800,
    forcedTransactions: 300,
    inputsPerTx: { p50: 1, p95: 4, p99: 12, max: 40 },
    outputsPerTx: { p50: 2, p95: 6, p99: 16, max: 60 },
    assetsPerOutput: { p50: 0, p95: 2, p99: 5, max: 20 },
    addresses: 5_000,
    assets: 400,
    searchMix: { uniqueHit: 0.5, multiHit: 0.25, miss: 0.25 },
    settledBlocks: REAL_SETTLED_BLOCKS,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 2_048, p99: 8_192, max: 65_536 },
    headerCborBytes: { p50: MEASURED_HEADER_CBOR_P50, p95: 1_024, p99: 2_048, max: 4_096 },
    headerHashBytes: 28,
    rootHexLength: 64,
    seed: 2,
    assumptions: [
      "txsPerBlock distribution: live data has 2 transactions across 9 blocks",
      "statusMix 98/2 terminal split: live data is 100% finalized, 0 abandoned",
      "txBodyBytes tail: p50 measured, p95/p99/max estimated",
      "headerCborBytes tail: p50 measured, tail estimated",
      "inputsPerTx / outputsPerTx / assetsPerOutput: no live transaction graph to measure",
      "addresses and assets cardinality: chosen for index selectivity, not observed",
      "depositsPerBlock / withdrawalsPerBlock / forcedPerBlock: no live distribution",
      "searchMix: chosen so every branch of the search path is exercised",
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
    statusMix: {
      finalized: 0.98,
      abandoned: 0.02,
      activeRows: 1,
      activeState: "observed_waiting_stability",
    },
    timestampCollisionRate: 0.05,
    ledgerUtxos: 200_000,
    ledgerTruncates: true,
    depositsPerBlock: { p50: 0, p95: 2, p99: 6, max: 20 },
    withdrawalsPerBlock: { p50: 0, p95: 1, p99: 3, max: 10 },
    forcedPerBlock: { p50: 0, p95: 0, p99: 1, max: 5 },
    deposits: 20_000,
    withdrawals: 8_000,
    forcedTransactions: 3_000,
    inputsPerTx: { p50: 1, p95: 4, p99: 12, max: 40 },
    outputsPerTx: { p50: 2, p95: 6, p99: 16, max: 60 },
    assetsPerOutput: { p50: 0, p95: 2, p99: 5, max: 20 },
    addresses: 50_000,
    assets: 4_000,
    searchMix: { uniqueHit: 0.5, multiHit: 0.25, miss: 0.25 },
    settledBlocks: REAL_SETTLED_BLOCKS,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 2_048, p99: 8_192, max: 65_536 },
    headerCborBytes: { p50: MEASURED_HEADER_CBOR_P50, p95: 1_024, p99: 2_048, max: 4_096 },
    headerHashBytes: 28,
    rootHexLength: 64,
    seed: 3,
    assumptions: [
      "txsPerBlock distribution, extended to max 500",
      "statusMix 98/2 terminal split",
      "txBodyBytes tail",
      "headerCborBytes tail",
      "inputsPerTx / outputsPerTx / assetsPerOutput",
      "addresses and assets cardinality",
      "depositsPerBlock / withdrawalsPerBlock / forcedPerBlock",
      "searchMix",
    ],
  },
} as const satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;
