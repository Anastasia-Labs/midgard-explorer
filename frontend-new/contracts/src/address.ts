import { Schema } from "effect";
import { DecimalString, HexString, IsoTimestamp, StatusString } from "./primitives";
import { TransactionView, ValueView } from "./transaction-view";

export const AddressHistoryRow = Schema.Struct({
  tx_id: HexString,
  address: Schema.String,
  height: Schema.NullOr(Schema.Number),
  header_hash: Schema.NullOr(HexString),
  time_stamp_tz: Schema.NullOr(IsoTimestamp),
  status: StatusString,
  /** Exact: read from this transaction's own outputs. */
  received: Schema.NullOr(DecimalString),
  /** Null whenever `spentComplete` is false: an unresolved input is unknown,
   * not zero. A transaction's inputs leave the ledger once it is applied, so
   * historical spends are commonly unresolvable. */
  spent: Schema.NullOr(DecimalString),
  spentComplete: Schema.Boolean,
  transaction: Schema.NullOr(TransactionView),
  decodeError: Schema.NullOr(Schema.String),
});
export type AddressHistoryRow = Schema.Schema.Type<typeof AddressHistoryRow>;

/** `undecodedOutputs` > 0 means the balance undercounts: outputs failed to decode. */
export const AddressResponse = Schema.Struct({
  balance: ValueView,
  undecodedOutputs: Schema.Number,
  utxoCount: Schema.Number,
  txCount: Schema.Number,
  firstActivity: Schema.NullOr(IsoTimestamp),
  latestActivity: Schema.NullOr(IsoTimestamp),
  history: Schema.Array(AddressHistoryRow),
});
export type AddressResponse = Schema.Schema.Type<typeof AddressResponse>;

export const decodeAddressResponse = Schema.decodeUnknownSync(AddressResponse);
