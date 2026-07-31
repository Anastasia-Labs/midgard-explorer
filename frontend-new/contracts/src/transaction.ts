import { Schema } from "effect";
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

export const TransactionFound = Schema.Struct({
  transaction: Schema.Struct({
    ...TransactionWithMeta.fields,
    pending: Schema.optional(Schema.Boolean),
  }),
  status: StatusString,
  admission: Schema.NullOr(TxAdmission),
});
export type TransactionFound = Schema.Schema.Type<typeof TransactionFound>;

/** The node knows the tx's lifecycle state but has no decodable body for it. */
export const TransactionLifecycleOnly = Schema.Struct({
  transaction: Schema.Null,
  status: StatusString,
  admission: Schema.NullOr(TxAdmission),
  rejection: Schema.optional(
    Schema.Struct({
      reasonCode: Schema.NullOr(Schema.String),
      reasonDetail: Schema.NullOr(Schema.String),
      rejectedAt: Schema.NullOr(IsoTimestamp),
    }),
  ),
});
export type TransactionLifecycleOnly = Schema.Schema.Type<typeof TransactionLifecycleOnly>;

export const TransactionResponse = Schema.Union(TransactionFound, TransactionLifecycleOnly);
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
