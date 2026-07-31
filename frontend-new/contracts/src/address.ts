import { Schema } from "effect";
import { HexString } from "./primitives";
import { TransactionView, ValueView } from "./transaction-view";

export const AddressHistoryRow = Schema.Struct({
  tx_id: HexString,
  address: Schema.String,
  transaction: Schema.NullOr(TransactionView),
  decodeError: Schema.NullOr(Schema.String),
});
export type AddressHistoryRow = Schema.Schema.Type<typeof AddressHistoryRow>;

/** `undecodedOutputs` > 0 means the balance undercounts: outputs failed to decode. */
export const AddressResponse = Schema.Struct({
  balance: ValueView,
  undecodedOutputs: Schema.Number,
  history: Schema.Array(AddressHistoryRow),
});
export type AddressResponse = Schema.Schema.Type<typeof AddressResponse>;

export const decodeAddressResponse = Schema.decodeUnknownSync(AddressResponse);
