import { Schema } from "effect";
import { DecimalString, IsoTimestamp } from "./primitives";

export const AssetMap = Schema.Record({
  key: Schema.String,
  value: Schema.Record({ key: Schema.String, value: DecimalString }),
});
export type AssetMap = Schema.Schema.Type<typeof AssetMap>;

export const ValueView = Schema.Struct({
  lovelace: DecimalString,
  assets: AssetMap,
});
export type ValueView = Schema.Schema.Type<typeof ValueView>;

export const OutRef = Schema.Struct({
  txId: Schema.String,
  index: Schema.Number,
});
export type OutRef = Schema.Schema.Type<typeof OutRef>;

export const InputView = Schema.Struct({
  txId: Schema.String,
  index: Schema.Number,
  /** Resolved spend side; null when not resolvable (spent/pruned). */
  resolved: Schema.NullOr(
    Schema.Struct({
      address: Schema.String,
      value: ValueView,
    }),
  ),
});
export type InputView = Schema.Schema.Type<typeof InputView>;

export const OutputView = Schema.Struct({
  address: Schema.String,
  value: ValueView,
  hasDatum: Schema.Boolean,
  hasScriptRef: Schema.Boolean,
});
export type OutputView = Schema.Schema.Type<typeof OutputView>;

export const WitnessSummary = Schema.Struct({
  vkeyCount: Schema.Number,
  scriptCount: Schema.Number,
  redeemerCount: Schema.Number,
});
export type WitnessSummary = Schema.Schema.Type<typeof WitnessSummary>;

export const TransactionView = Schema.Struct({
  txId: Schema.String,
  formatVersion: Schema.Number,
  /** "TxIsValid" | "TxIsInvalid" today; kept open for unknown future values. */
  validity: Schema.String,
  fee: DecimalString,
  validityInterval: Schema.Struct({
    start: Schema.NullOr(DecimalString),
    end: Schema.NullOr(DecimalString),
  }),
  networkId: Schema.NullOr(Schema.Number),
  inputs: Schema.Array(InputView),
  referenceInputs: Schema.Array(OutRef),
  outputs: Schema.Array(OutputView),
  mint: Schema.NullOr(Schema.Struct({ policyIds: Schema.Array(Schema.String) })),
  witnesses: WitnessSummary,
  /** True while the tx is still in the mempool. */
  pending: Schema.optional(Schema.Boolean),
});
export type TransactionView = Schema.Schema.Type<typeof TransactionView>;

export const TransactionWithMeta = Schema.Struct({
  ...TransactionView.fields,
  timestamp: IsoTimestamp,
});
export type TransactionWithMeta = Schema.Schema.Type<typeof TransactionWithMeta>;
