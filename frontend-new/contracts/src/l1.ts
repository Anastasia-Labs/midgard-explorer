import { Schema } from "effect";
import { DecimalString, HexString, IsoTimestamp, SignedDecimalString, paged } from "./primitives";

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
  blockHash: Schema.String,
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

export const L1SummaryResponse = Schema.Struct({
  /** Nullable rather than defaulted: a missing source must never be read as
   * "this is live data". */
  source: Schema.NullOr(L1SourceIdentity),
  transactions: Schema.Number,
  events: Schema.Number,
  blockHeaders: Schema.Number,
  lastSyncedHeight: Schema.NullOr(Schema.Number),
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
  scriptHash: Schema.String,
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

/** One transaction with every section the indexer stored. `collateralOutput`
 * is singular because a transaction returns at most one. */
export const L1TransactionResponse = Schema.Struct({
  txHash: HexString,
  blockHeight: Schema.Number,
  blockHash: Schema.String,
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
});
export type L1TransactionResponse = Schema.Schema.Type<typeof L1TransactionResponse>;

export const decodeL1Summary = Schema.decodeUnknownSync(L1SummaryResponse);
export const decodeL1TxsPage = Schema.decodeUnknownSync(L1TxsPageResponse);
export const decodeL1Transaction = Schema.decodeUnknownSync(L1TransactionResponse);
