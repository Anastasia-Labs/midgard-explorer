import { Schema } from "effect";
import {
  DecimalString,
  Hash28,
  Hash32,
  HexString,
  IsoTimestamp,
  SignedDecimalString,
  paged,
} from "./primitives";

/**
 * The explorer's own Cardano L1 index, as served by the indexer routes.
 *
 * These lived as hand-written decoders in the app because the indexer routes
 * shipped without a contract. That was a documented shortcut, and this repays
 * it: the app and any other consumer now agree on one definition, and a shape
 * change fails at the boundary rather than as an undefined three components
 * deep.
 *
 * Lovelace stays a STRING all the way to the screen. These values routinely
 * exceed Number.MAX_SAFE_INTEGER, and rounding them would misreport balances.
 */

/** Which deployment the figures describe and which database they came from.
 *
 * `isFixture` is the load-bearing field. The explorer once read a phase-4 test
 * database for weeks and presented it as the live chain, so a consumer must be
 * able to tell, and the type must not let it default quietly to "live". */
export const L1SourceIdentity = Schema.Struct({
  /** Manifest id of the indexed deployment. Null when the manifest predates
   * the field. */
  deployment: Schema.NullOr(Schema.String),
  network: Schema.String,
  deployedAt: IsoTimestamp,
  l2Database: Schema.String,
  isFixture: Schema.Boolean,
  /** Validators accepted from the active deployment manifest after shared
   * placeholder hashes have been excluded. These are trust anchors, not
   * frontend guesses based on an address prefix. */
  validators: Schema.Array(
    Schema.Struct({
      entryName: Schema.String,
      family: Schema.String,
      scriptHash: HexString,
      address: Schema.String,
    }),
  ),
});
export type L1SourceIdentity = Schema.Schema.Type<typeof L1SourceIdentity>;
export type L1ValidatorIdentity = L1SourceIdentity["validators"][number];

export const L1EventSummary = Schema.Struct({
  validator: Schema.String,
  eventType: Schema.String,
  lovelace: Schema.String,
});
export type L1EventSummary = Schema.Schema.Type<typeof L1EventSummary>;

export const L1TxRow = Schema.Struct({
  txHash: HexString,
  blockHeight: Schema.Number,
  blockHash: Hash32,
  slot: Schema.Number,
  epoch: Schema.Number,
  txTime: IsoTimestamp,
  fee: DecimalString,
  size: Schema.Number,
  totalOutput: DecimalString,
  events: Schema.Array(L1EventSummary),
});
export type L1TxRow = Schema.Schema.Type<typeof L1TxRow>;

export const L1TxsPageResponse = paged(L1TxRow);
export type L1TxsPageResponse = Schema.Schema.Type<typeof L1TxsPageResponse>;

export const L1ValidatorCount = Schema.Struct({
  validator: Schema.String,
  count: Schema.Number,
});
export type L1ValidatorCount = Schema.Schema.Type<typeof L1ValidatorCount>;

/** How much of the L1 chain the index holds.
 *
 * An empty list of L1 transactions cannot say on its own whether the chain had
 * no activity or the index was never built, and those are different things to
 * show a reader. The list routes still answer with an empty page; this is what
 * lets a page label it correctly.
 */
export const L1SyncState = Schema.Literal("unbuilt", "indexing", "reconciled");
export type L1SyncState = Schema.Schema.Type<typeof L1SyncState>;

export const L1SyncCursor = Schema.Struct({
  source: Schema.String,
  height: Schema.NullOr(Schema.Number),
});
export type L1SyncCursor = Schema.Schema.Type<typeof L1SyncCursor>;

/** Every cursor, not only the verdict: three heights that disagree say which
 * source is behind, which one boolean cannot. */
export const L1Sync = Schema.Struct({
  state: L1SyncState,
  cursors: Schema.Array(L1SyncCursor),
});
export type L1Sync = Schema.Schema.Type<typeof L1Sync>;

export const L1SummaryResponse = Schema.Struct({
  /** Nullable rather than defaulted: a missing source must never be read as
   * "this is live data". */
  source: Schema.NullOr(L1SourceIdentity),
  transactions: Schema.Number,
  events: Schema.Number,
  blockHeaders: Schema.Number,
  lastSyncedHeight: Schema.NullOr(Schema.Number),
  sync: L1Sync,
  byValidator: Schema.Array(L1ValidatorCount),
});
export type L1SummaryResponse = Schema.Schema.Type<typeof L1SummaryResponse>;

/** One UTxO as the indexer stored it, in any of the five sections a
 * transaction has. Assets hang off the UTxO they were found in. */
export const L1TxIo = Schema.Struct({
  kind: Schema.String,
  position: Schema.Number,
  sourceTxHash: HexString,
  sourceIndex: Schema.Number,
  address: Schema.NullOr(Schema.String),
  paymentCred: Schema.NullOr(Schema.String),
  stakeAddr: Schema.NullOr(Schema.String),
  lovelace: DecimalString,
  datumHash: Schema.NullOr(Schema.String),
  inlineDatum: Schema.NullOr(Schema.Unknown),
  refScriptHash: Schema.NullOr(Schema.String),
  /** The indexed transaction that consumed this UTxO. Present only on a UTxO
   * this transaction produced, and null when no INDEXED transaction spent it:
   * the index covers Midgard-related transactions, so null is silence rather
   * than a claim of unspent. Optional so an older backend still parses. */
  spentBy: Schema.optional(Schema.NullOr(HexString)),
  assets: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      policyId: HexString,
      assetName: HexString,
      fingerprint: Schema.NullOr(Schema.String),
      quantity: SignedDecimalString,
    }),
  ),
});
export type L1TxIo = Schema.Schema.Type<typeof L1TxIo>;

export const L1Redeemer = Schema.Struct({
  scriptHash: Hash28,
  address: Schema.NullOr(Schema.String),
  purpose: Schema.String,
  memUnits: DecimalString,
  stepUnits: DecimalString,
  fee: DecimalString,
  datumHash: Schema.NullOr(Schema.String),
  datum: Schema.NullOr(Schema.Unknown),
  validContract: Schema.Boolean,
  scriptSize: Schema.NullOr(Schema.Number),
});
export type L1Redeemer = Schema.Schema.Type<typeof L1Redeemer>;

export const L1Event = Schema.Struct({
  validator: Schema.String,
  eventType: Schema.String,
  outputIndex: Schema.Number,
  lovelace: DecimalString,
  datum: Schema.NullOr(Schema.Unknown),
  deployment: Schema.String,
  decoded: Schema.NullOr(Schema.Unknown),
});
export type L1Event = Schema.Schema.Type<typeof L1Event>;

/** A protocol action proven by indexed Midgard data. This deliberately carries
 * state, not UI prose: each client can phrase it without making the indexer a
 * copy-writing layer. */
export const L1MidgardAction = Schema.Struct({
  kind: Schema.Literal(
    "deposit",
    "withdrawal",
    "block_commitment",
    "scheduler_shift",
    "validator_execution",
  ),
  family: Schema.String,
  outputIndex: Schema.NullOr(Schema.Number),
  lovelace: Schema.NullOr(DecimalString),
  operation: Schema.NullOr(Schema.String),
  validContract: Schema.NullOr(Schema.Boolean),
  operator: Schema.NullOr(HexString),
  startTime: Schema.NullOr(DecimalString),
  /** What a scheduler shift passed over. "none" is a decoded answer, null
   * means the action cannot neglect anything. Optional so an older backend
   * that predates the field still parses. */
  neglected: Schema.optional(
    Schema.NullOr(Schema.Literal("none", "deposit", "withdrawal", "txOrder")),
  ),
  /** Who the user event's own datum names. Tagged by kind because a deposit
   * and a withdrawal prove different things: a deposit carries the L2
   * credential the funds are destined for, a withdrawal carries the owner and
   * the L2 UTxO being withdrawn. Optional so an older backend still parses.
   *
   * No amount here. A deposit's value is the event UTxO's own value, which is
   * `lovelace` above, and a withdrawal's l2_value is not among the fields the
   * datum decoder extracts. */
  userEvent: Schema.optional(
    Schema.NullOr(
      Schema.Union(
        Schema.Struct({
          kind: Schema.Literal("deposit"),
          l2PaymentCredential: HexString,
          l2StakeCredential: Schema.NullOr(HexString),
          l2NetworkId: Schema.Number,
          inclusionTime: DecimalString,
        }),
        Schema.Struct({
          kind: Schema.Literal("withdrawal"),
          l2Owner: HexString,
          l2OutRef: Schema.Struct({ txHash: HexString, index: Schema.Number }),
          inclusionTime: DecimalString,
        }),
      ),
    ),
  ),
  headerHash: Schema.NullOr(HexString),
});
export type L1MidgardAction = Schema.Schema.Type<typeof L1MidgardAction>;

/** One transaction with every section the indexer stored. `collateralOutput`
 * is singular because a transaction returns at most one. */
export const L1TransactionResponse = Schema.Struct({
  txHash: HexString,
  blockHeight: Schema.Number,
  blockHash: Hash32,
  slot: Schema.Number,
  epoch: Schema.Number,
  txTime: IsoTimestamp,
  fee: DecimalString,
  size: Schema.Number,
  totalOutput: DecimalString,
  blockIndex: Schema.Number,
  certDeposit: DecimalString,
  invalidBefore: Schema.NullOr(DecimalString),
  invalidAfter: Schema.NullOr(DecimalString),
  metadata: Schema.NullOr(Schema.Unknown),
  actions: Schema.Array(L1MidgardAction),
  events: Schema.Array(L1Event),
  inputs: Schema.Array(L1TxIo),
  outputs: Schema.Array(L1TxIo),
  referenceInputs: Schema.Array(L1TxIo),
  collateral: Schema.Array(L1TxIo),
  collateralOutput: Schema.NullOr(L1TxIo),
  mints: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      policyId: HexString,
      assetName: HexString,
      fingerprint: Schema.NullOr(Schema.String),
      quantity: SignedDecimalString,
    }),
  ),
  redeemers: Schema.Array(L1Redeemer),
  /** Cardano's execution limits for the epoch this transaction is in, as the
   * chain reported them. Null when the indexer holds no parameters for that
   * epoch, in which case execution units are shown without a share: a budget
   * needs a denominator that is true, and a guessed one is worse than none.
   * Optional so a backend that predates the field still parses. */
  protocolParams: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        epochNo: Schema.Number,
        maxTxExMem: DecimalString,
        maxTxExSteps: DecimalString,
      }),
    ),
  ),
});
export type L1TransactionResponse = Schema.Schema.Type<typeof L1TransactionResponse>;

/** A Midgard header decoded from the state-queue datum observed on Cardano.
 * This is L1 evidence and must not be described as node-local DA retention. */
export const L1BlockHeader = Schema.Struct({
  headerHash: HexString,
  l1TxHash: Schema.NullOr(HexString),
  blockHeight: Schema.NullOr(Schema.Number),
  prevUtxosRoot: HexString,
  utxosRoot: HexString,
  withdrawalsRoot: HexString,
  forcedTransactionsRoot: HexString,
  transactionsRoot: HexString,
  depositsRoot: HexString,
  transitionTraceRoot: HexString,
  eventToStepRoot: HexString,
  withdrawalCount: DecimalString,
  forcedTransactionCount: DecimalString,
  l2TransactionCount: DecimalString,
  depositCount: DecimalString,
  totalEventCount: DecimalString,
  transitionStepCount: DecimalString,
  startTime: DecimalString,
  endTime: DecimalString,
  prevHeaderHash: HexString,
  operatorVkey: HexString,
  protocolVersion: DecimalString,
});
export type L1BlockHeader = Schema.Schema.Type<typeof L1BlockHeader>;

const L1ValidatorHistoryRow = Schema.Struct({
  txHash: HexString,
  blockHeight: Schema.Number,
  txTime: IsoTimestamp,
  ioCount: Schema.Number,
  executionCount: Schema.Number,
  eventCount: Schema.Number,
});

const L1ValidatorUtxo = Schema.extend(
  L1TxIo,
  Schema.Struct({
    tx: Schema.Struct({
      txHash: HexString,
      blockHeight: Schema.Number,
      txTime: IsoTimestamp,
    }),
  }),
);

export const L1ValidatorResponse = Schema.Struct({
  deployment: Schema.String,
  validator: Schema.Struct({
    entryName: Schema.String,
    family: Schema.String,
    scriptHash: HexString,
    address: Schema.String,
  }),
  coverage: Schema.Struct({ limitedTo: Schema.Number, truncated: Schema.Boolean }),
  utxos: Schema.Array(L1ValidatorUtxo),
  history: Schema.Array(L1ValidatorHistoryRow),
  operations: Schema.Array(
    Schema.Struct({
      purpose: Schema.String,
      validContract: Schema.Boolean,
      count: Schema.Number,
      memUnits: DecimalString,
      stepUnits: DecimalString,
      fee: DecimalString,
    }),
  ),
});
export type L1ValidatorResponse = Schema.Schema.Type<typeof L1ValidatorResponse>;

/** Deposit evidence emitted by the Cardano indexer, including the containing
 * L1 transaction. It complements the node's bridge lifecycle row. */
export const L1DepositObservation = Schema.Struct({
  txHash: HexString,
  validator: Schema.String,
  eventType: Schema.String,
  outputIndex: Schema.Number,
  lovelace: DecimalString,
  deployment: Schema.String,
  decoded: Schema.NullOr(Schema.Unknown),
  /** Address of the exact L1 outref named by the canonical deposit datum.
   * Empty when that input or datum was unavailable; never inferred from an
   * unrelated transaction input. */
  fundingAddresses: Schema.Array(Schema.String),
  tx: Schema.Struct({
    txHash: HexString,
    blockHeight: Schema.Number,
    blockHash: Hash32,
    slot: Schema.Number,
    epoch: Schema.Number,
    txTime: IsoTimestamp,
    fee: DecimalString,
    size: Schema.Number,
    totalOutput: DecimalString,
  }),
});
export type L1DepositObservation = Schema.Schema.Type<typeof L1DepositObservation>;

export const decodeL1Summary = Schema.decodeUnknownSync(L1SummaryResponse);
export const decodeL1TxsPage = Schema.decodeUnknownSync(L1TxsPageResponse);
export const decodeL1Transaction = Schema.decodeUnknownSync(L1TransactionResponse);
export const decodeL1BlockHeaders = Schema.decodeUnknownSync(Schema.Array(L1BlockHeader));
export const decodeL1BlockHeader = Schema.decodeUnknownSync(L1BlockHeader);
export const decodeL1Deposits = Schema.decodeUnknownSync(Schema.Array(L1DepositObservation));
export const decodeL1Validator = Schema.decodeUnknownSync(L1ValidatorResponse);
