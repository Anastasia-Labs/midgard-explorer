import { Schema } from "effect";
import { BlockFinalization } from "./block";
import { HexString, IsoTimestamp, StatusString, paged } from "./primitives";
import { TransactionView, TransactionWithMeta } from "./transaction-view";

/** Admission metadata recorded by the node before a transaction reaches a ledger tier. */
export const TxAdmission = Schema.Struct({
  status: StatusString,
  firstSeenAt: IsoTimestamp,
  validationStartedAt: Schema.NullOr(IsoTimestamp),
  terminalAt: Schema.NullOr(IsoTimestamp),
  updatedAt: IsoTimestamp,
  attemptCount: Schema.Number,
  requestCount: Schema.Number,
  submitSource: Schema.String,
});
export type TxAdmission = Schema.Schema.Type<typeof TxAdmission>;

/** The L2 block that included the transaction. Present once a block carries it,
 * which is what makes settlement state reachable from a transaction. */
export const TxInclusion = Schema.Struct({
  height: Schema.Number,
  header_hash: HexString,
  time_stamp_tz: IsoTimestamp,
});
export type TxInclusion = Schema.Schema.Type<typeof TxInclusion>;

/** Why the body could not be read. Everything outside the body stays valid, so
 * this travels with a 200 rather than replacing the response with an error. */
export const TxDecodeError = Schema.Struct({
  code: Schema.String,
  detail: Schema.NullOr(Schema.String),
});
export type TxDecodeError = Schema.Schema.Type<typeof TxDecodeError>;

/** Execution, inclusion and settlement are three separate questions; the
 * response answers each on its own rather than overloading `status`. */
const TransactionEnvelope = {
  txId: HexString,
  status: StatusString,
  admission: Schema.NullOr(TxAdmission),
  inclusion: Schema.NullOr(TxInclusion),
  finalization: Schema.NullOr(BlockFinalization),
};

export const TransactionFound = Schema.Struct({
  ...TransactionEnvelope,
  transaction: Schema.Struct({
    ...TransactionWithMeta.fields,
    pending: Schema.optional(Schema.Boolean),
  }),
  decodeError: Schema.optional(Schema.Null),
});
export type TransactionFound = Schema.Schema.Type<typeof TransactionFound>;

/** The transaction is on the ledger but its body could not be decoded. */
export const TransactionUndecodable = Schema.Struct({
  ...TransactionEnvelope,
  transaction: Schema.Null,
  decodeError: TxDecodeError,
});
export type TransactionUndecodable = Schema.Schema.Type<typeof TransactionUndecodable>;

/** The node knows the tx's lifecycle state but has no body for it at all. */
export const TransactionLifecycleOnly = Schema.Struct({
  ...TransactionEnvelope,
  transaction: Schema.Null,
  decodeError: Schema.optional(Schema.Null),
  rejection: Schema.optional(
    Schema.Struct({
      reasonCode: Schema.NullOr(Schema.String),
      reasonDetail: Schema.NullOr(Schema.String),
      rejectedAt: Schema.NullOr(IsoTimestamp),
    }),
  ),
});
export type TransactionLifecycleOnly = Schema.Schema.Type<typeof TransactionLifecycleOnly>;

export const TransactionResponse = Schema.Union(
  TransactionFound,
  TransactionUndecodable,
  TransactionLifecycleOnly,
);
export type TransactionResponse = Schema.Schema.Type<typeof TransactionResponse>;

export const RecentTxRow = Schema.Struct({
  height: Schema.Number,
  header_hash: HexString,
  tx_id: HexString,
  time_stamp_tz: IsoTimestamp,
});
export type RecentTxRow = Schema.Schema.Type<typeof RecentTxRow>;

export const RecentTxsResponse = Schema.Struct({
  rows: Schema.Array(RecentTxRow),
});
export type RecentTxsResponse = Schema.Schema.Type<typeof RecentTxsResponse>;

export const TxPageRow = Schema.Struct({
  header_hash: HexString,
  tx_id: HexString,
  time_stamp_tz: IsoTimestamp,
  transaction: Schema.NullOr(TransactionView),
  decodeError: Schema.NullOr(Schema.String),
});
export type TxPageRow = Schema.Schema.Type<typeof TxPageRow>;

export const TxsPageResponse = paged(TxPageRow);
export type TxsPageResponse = Schema.Schema.Type<typeof TxsPageResponse>;

export const decodeTransactionResponse = Schema.decodeUnknownSync(TransactionResponse);
export const decodeRecentTxs = Schema.decodeUnknownSync(RecentTxsResponse);
export const decodeTxsPage = Schema.decodeUnknownSync(TxsPageResponse);
