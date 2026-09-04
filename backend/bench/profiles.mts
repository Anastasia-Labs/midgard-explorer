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

/**
 * `tx_admissions.status`, the four values `public.tx_admission_status` permits.
 *
 * Seeding these is not free: `tx_admissions_check1` requires a lease owner and
 * expiry on `validating` and forbids them elsewhere, and `tx_admissions_check2`
 * requires `terminal_at` on the two terminal states and forbids it on the two
 * live ones. A mix is a set of constraints, not just a ratio.
 */
export type AdmissionMix = {
  queued: number;
  validating: number;
  accepted: number;
  rejected: number;
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
  /**
   * Per-block event counts. These are authoritative and the dataset totals are
   * derived from them by `expectedTotals`.
   *
   * An earlier draft stated both, and they contradicted: these shapes imply
   * 3,700 deposits and 1,850 withdrawals at 5,000 blocks, against stated totals
   * of 2,000 and 800. A generator cannot honour both, so it would have silently
   * broken whichever it checked second.
   */
  depositsPerBlock: Shape;
  withdrawalsPerBlock: Shape;
  forcedPerBlock: Shape;
  inputsPerTx: Shape;
  outputsPerTx: Shape;
  /** Native assets on one output, over and above ada. */
  assetsPerOutput: Shape;
  /** Distinct L2 addresses across the dataset. */
  addresses: number;
  /** Distinct native assets (policy plus name) across the dataset. */
  assets: number;
  /**
   * Zipf exponent for address activity. Zero is uniform.
   *
   * Uniform is the trap: 5,000 addresses over 5,000 transactions gives every
   * address about one entry, so `address-history` measures a one-row page and
   * passes. Real explorers are dominated by a few hot addresses, and those are
   * the pages that hurt.
   */
  addressSkew: number;
  /** Zipf exponent for holders per asset. Same trap as `addressSkew`. */
  assetHolderSkew: number;
  /** Quantity held per asset position. A flat quantity hides digit-width cost. */
  assetQuantity: Shape;
  /** Fraction of outputs carrying an inline datum. */
  datumRate: number;
  /** Fraction of outputs carrying a script reference. */
  scriptRefRate: number;
  /** Fraction of transactions carrying redeemers. */
  redeemerRate: number;
  /** `tx_admissions.status` split. Drives the metrics panel and the tx page. */
  admissionMix: AdmissionMix;
  /** `event_info` and `raw_event_info` sizes on deposits and withdrawals. */
  eventPayloadBytes: Shape;
  /**
   * Transactions sitting in `mempool`, admitted but not yet in a block.
   *
   * Zero here is a silent coverage gap rather than a small one: the mempool
   * panel renders, shows nothing, and its budget passes.
   */
  mempoolTransactions: number;
  /** Transactions in `processed_mempool`, processed but not finalized. */
  processedMempoolTransactions: number;
  searchMix: SearchMix;
  /**
   * I6: blocks that also exist in the real L1 index snapshot.
   *
   * The snapshot holds 9 real `l1_block_header` rows, so at most 9 generated
   * blocks can carry a real settlement counterpart. Every other block is
   * legitimately unsettled, which is a state the routes must render as such.
   */
  settledBlocks: number;
  /**
   * Expected transaction size, an **outcome** of the structure shapes above
   * rather than an input to them. Inputs, outputs and assets per output
   * determine the bytes; specifying both independently over-constrains the
   * generator and lets it satisfy one by violating the other.
   *
   * Corroborated: the codec encodes a 1-input, 2-output transaction at 386
   * bytes, against a measured live p50 of 383. The structural p50 and the byte
   * p50 agree without being forced to.
   *
   * `max` is reached only by `oversizeTransactions`, never by the shapes.
   */
  txBodyBytes: Shape;
  /**
   * Transactions built deliberately larger than `MAX_INLINE_CBOR_BYTES`.
   *
   * `decode/transaction.ts:512` sets `cborTruncated` on
   * `txBytes.length > MAX_INLINE_CBOR_BYTES`, so a transaction of exactly
   * 64 KB does not truncate. The structure shapes top out near 6 KB, so
   * without these the `transaction-detail` truncation path is never measured
   * and its budget passes on the easy case. Same defect as sizing the ledger
   * at exactly `SCAN_LIMIT` (I12).
   */
  oversizeTransactions: number;
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

/** Mirrors `MAX_INLINE_CBOR_BYTES` in `src/decode/transaction.ts`. */
export const MAX_INLINE_CBOR_BYTES = 64 * 1024;

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
    inputsPerTx: { p50: 1, p95: 3, p99: 4, max: 5 },
    outputsPerTx: { p50: 2, p95: 4, p99: 5, max: 6 },
    assetsPerOutput: { p50: 0, p95: 1, p99: 2, max: 3 },
    addresses: 40,
    assets: 8,
    addressSkew: 1.1,
    assetHolderSkew: 1.1,
    assetQuantity: { p50: 1, p95: 1_000, p99: 100_000, max: 10_000_000 },
    datumRate: 0.1,
    scriptRefRate: 0.05,
    redeemerRate: 0.1,
    admissionMix: { queued: 0.1, validating: 0.05, accepted: 0.8, rejected: 0.05 },
    eventPayloadBytes: { p50: 88, p95: 274, p99: 512, max: 1_024 },
    mempoolTransactions: 6,
    processedMempoolTransactions: 3,
    searchMix: { uniqueHit: 0.5, multiHit: 0.25, miss: 0.25 },
    settledBlocks: REAL_SETTLED_BLOCKS,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 800, p99: 1_200, max: 66_000 },
    oversizeTransactions: 1,
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
    inputsPerTx: { p50: 1, p95: 4, p99: 12, max: 40 },
    outputsPerTx: { p50: 2, p95: 6, p99: 16, max: 60 },
    assetsPerOutput: { p50: 0, p95: 2, p99: 5, max: 20 },
    addresses: 5_000,
    assets: 400,
    addressSkew: 1.2,
    assetHolderSkew: 1.2,
    assetQuantity: { p50: 1, p95: 10_000, p99: 1_000_000, max: 9_000_000_000 },
    datumRate: 0.15,
    scriptRefRate: 0.05,
    redeemerRate: 0.2,
    admissionMix: { queued: 0.05, validating: 0.02, accepted: 0.85, rejected: 0.08 },
    eventPayloadBytes: { p50: 88, p95: 274, p99: 1_024, max: 4_096 },
    mempoolTransactions: 200,
    processedMempoolTransactions: 80,
    searchMix: { uniqueHit: 0.5, multiHit: 0.25, miss: 0.25 },
    settledBlocks: REAL_SETTLED_BLOCKS,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 2_048, p99: 6_144, max: 96_000 },
    oversizeTransactions: 5,
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
    inputsPerTx: { p50: 1, p95: 4, p99: 12, max: 40 },
    outputsPerTx: { p50: 2, p95: 6, p99: 16, max: 60 },
    assetsPerOutput: { p50: 0, p95: 2, p99: 5, max: 20 },
    addresses: 50_000,
    assets: 4_000,
    addressSkew: 1.2,
    assetHolderSkew: 1.2,
    assetQuantity: { p50: 1, p95: 10_000, p99: 1_000_000, max: 9_000_000_000 },
    datumRate: 0.15,
    scriptRefRate: 0.05,
    redeemerRate: 0.2,
    admissionMix: { queued: 0.05, validating: 0.02, accepted: 0.85, rejected: 0.08 },
    eventPayloadBytes: { p50: 88, p95: 274, p99: 1_024, max: 4_096 },
    mempoolTransactions: 2_000,
    processedMempoolTransactions: 800,
    searchMix: { uniqueHit: 0.5, multiHit: 0.25, miss: 0.25 },
    settledBlocks: REAL_SETTLED_BLOCKS,
    txBodyBytes: { p50: MEASURED_TX_BODY_P50, p95: 2_048, p99: 6_144, max: 96_000 },
    oversizeTransactions: 20,
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

/**
 * The dataset totals a profile implies.
 *
 * Derived, never declared. The per-block shapes are the specification; a total
 * stated beside them is a second source of truth that can disagree, and did.
 */
export function expectedTotals(profile: Profile): {
  deposits: number;
  withdrawals: number;
  forcedTransactions: number;
} {
  return {
    deposits: Math.round(meanOf(profile.depositsPerBlock) * profile.blocks),
    withdrawals: Math.round(meanOf(profile.withdrawalsPerBlock) * profile.blocks),
    forcedTransactions: Math.round(
      meanOf(profile.forcedPerBlock) * profile.blocks,
    ),
  };
}

/**
 * The mean of a shape under the same piecewise-linear inverse CDF the sampler
 * uses, so a predicted total and a generated one agree.
 */
export function meanOf(shape: Shape): number {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const at = (q: number) => {
    if (q < 0.5) return lerp(0, shape.p50, q / 0.5);
    if (q < 0.95) return lerp(shape.p50, shape.p95, (q - 0.5) / 0.45);
    if (q < 0.99) return lerp(shape.p95, shape.p99, (q - 0.95) / 0.04);
    return lerp(shape.p99, shape.max, (q - 0.99) / 0.01);
  };
  const steps = 20_000;
  let total = 0;
  for (let i = 0; i < steps; i += 1) {
    total += Math.max(0, Math.round(at((i + 0.5) / steps)));
  }
  return total / steps;
}
