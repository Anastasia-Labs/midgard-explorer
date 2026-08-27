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
  finalization_status: Schema.NullOr(StatusString),
  /** Exact: read from this transaction's own outputs. */
  received: Schema.NullOr(ValueView),
  /** Null whenever `spentComplete` is false: an unresolved input is unknown,
   * not zero. A transaction's inputs leave the ledger once it is applied, so
   * historical spends are commonly unresolvable. */
  spent: Schema.NullOr(ValueView),
  spentComplete: Schema.Boolean,
  transaction: Schema.NullOr(TransactionView),
  decodeError: Schema.NullOr(Schema.String),
});
export type AddressHistoryRow = Schema.Schema.Type<typeof AddressHistoryRow>;

/** One spendable entry behind the balance.
 *
 * A UTxO whose output would not decode is present with a null value and its
 * error rather than absent: an address holding six UTxOs of which one is
 * unreadable must show six rows and a warning, never five rows and a quietly
 * smaller total. `outRefHex` is the ledger's own key and is always present,
 * even when it did not parse into a transaction and index. */
export const AddressUtxo = Schema.Struct({
  txId: Schema.NullOr(HexString),
  index: Schema.NullOr(Schema.Number),
  outRefHex: HexString,
  value: Schema.NullOr(ValueView),
  hasDatum: Schema.Boolean,
  hasScriptRef: Schema.Boolean,
  decodeError: Schema.NullOr(Schema.String),
});
export type AddressUtxo = Schema.Schema.Type<typeof AddressUtxo>;

/** `undecodedOutputs` > 0 means the balance undercounts: outputs failed to decode. */
export const AddressResponse = Schema.Struct({
  balance: ValueView,
  undecodedOutputs: Schema.Number,
  utxoCount: Schema.Number,
  utxos: Schema.Array(AddressUtxo),
  txCount: Schema.Number,
  historyPage: Schema.Number,
  hasNextPage: Schema.Boolean,
  limit: Schema.Number,
  firstActivity: Schema.NullOr(IsoTimestamp),
  latestActivity: Schema.NullOr(IsoTimestamp),
  history: Schema.Array(AddressHistoryRow),
});
export type AddressResponse = Schema.Schema.Type<typeof AddressResponse>;

const decodeCurrentAddressResponse = Schema.decodeUnknownSync(AddressResponse);

/** Rolling deployments can briefly pair the current frontend with the earlier
 * address endpoint. That response was complete for its time but represented
 * movement as ADA strings and had no pagination or finalization fields. Keep a
 * narrow adapter here so a restart overlap does not blank the entire address
 * page; new responses always take the strict path above. */
const LegacyAddressHistoryRow = Schema.Struct({
  tx_id: HexString,
  address: Schema.String,
  height: Schema.NullOr(Schema.Number),
  header_hash: Schema.NullOr(HexString),
  time_stamp_tz: Schema.NullOr(IsoTimestamp),
  status: StatusString,
  received: Schema.NullOr(DecimalString),
  spent: Schema.NullOr(DecimalString),
  spentComplete: Schema.Boolean,
  transaction: Schema.NullOr(TransactionView),
  decodeError: Schema.NullOr(Schema.String),
});

const LegacyAddressResponse = Schema.Struct({
  balance: ValueView,
  undecodedOutputs: Schema.Number,
  utxoCount: Schema.Number,
  utxos: Schema.Array(AddressUtxo),
  txCount: Schema.Number,
  firstActivity: Schema.NullOr(IsoTimestamp),
  latestActivity: Schema.NullOr(IsoTimestamp),
  history: Schema.Array(LegacyAddressHistoryRow),
});

const decodeLegacyAddressResponse = Schema.decodeUnknownSync(LegacyAddressResponse);

export const decodeAddressResponse = (input: unknown): AddressResponse => {
  try {
    return decodeCurrentAddressResponse(input);
  } catch {
    const legacy = decodeLegacyAddressResponse(input);
    const limit = Math.max(1, legacy.history.length);
    return decodeCurrentAddressResponse({
      ...legacy,
      historyPage: 1,
      hasNextPage: false,
      limit,
      history: legacy.history.map((row) => ({
        ...row,
        finalization_status: null,
        received: row.received === null ? null : { lovelace: row.received, assets: {} },
        spent: row.spent === null ? null : { lovelace: row.spent, assets: {} },
      })),
    });
  }
};
