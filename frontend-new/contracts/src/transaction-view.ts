import { Schema } from "effect";
import { DecimalString, IsoTimestamp, SignedDecimalString } from "./primitives";

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

/** "Script" | "PubKey" today. Kept open rather than a literal union: an
 * unrecognized kind must render as itself, not fail the page. */
export const AddressKind = Schema.String;

export const CredentialView = Schema.Struct({
  kind: AddressKind,
  hash: Schema.String,
});
export type CredentialView = Schema.Schema.Type<typeof CredentialView>;

export const AddressIdentityView = Schema.Struct({
  payment: CredentialView,
  stake: Schema.NullOr(CredentialView),
  protected: Schema.Boolean,
  networkId: Schema.Number,
});
export type AddressIdentityView = Schema.Schema.Type<typeof AddressIdentityView>;

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
      addressKind: AddressKind,
      identity: AddressIdentityView,
      value: ValueView,
    }),
  ),
});
export type InputView = Schema.Schema.Type<typeof InputView>;

/** Midgard-native datums are always inline, so there is no datum-hash variant.
 * `json` is nullable: a datum the codec cannot render degrades to hex rather
 * than failing the response. */
export const DatumView = Schema.Struct({
  cborHex: Schema.String,
  json: Schema.NullOr(Schema.Unknown),
});
export type DatumView = Schema.Schema.Type<typeof DatumView>;

/** Kept open rather than a literal union: an unrecognized language must render
 * as itself, not 404 the page. */
export const ScriptLanguage = Schema.String;

export const ScriptRefView = Schema.Struct({
  hash: Schema.String,
  language: ScriptLanguage,
  cborHex: Schema.String,
  source: Schema.Literal("reference_output"),
  hashVerified: Schema.Literal(true),
});
export type ScriptRefView = Schema.Schema.Type<typeof ScriptRefView>;

export const OutputStateView = Schema.Struct({
  status: Schema.Literal("unspent", "not_in_current_ledger", "unknown"),
  consumedBy: Schema.NullOr(OutRef),
});
export type OutputStateView = Schema.Schema.Type<typeof OutputStateView>;

export const OutputView = Schema.Struct({
  index: Schema.Number,
  address: Schema.String,
  addressKind: AddressKind,
  identity: AddressIdentityView,
  value: ValueView,
  /** Kept beside `datum` and `scriptRef` so existing readers keep working. */
  hasDatum: Schema.Boolean,
  hasScriptRef: Schema.Boolean,
  datum: Schema.NullOr(DatumView),
  scriptRef: Schema.NullOr(ScriptRefView),
  state: OutputStateView,
});
export type OutputView = Schema.Schema.Type<typeof OutputView>;

export const ScriptWitnessView = Schema.Struct({
  hash: Schema.String,
  language: ScriptLanguage,
  cborHex: Schema.String,
  source: Schema.Literal("witness_set"),
  hashVerified: Schema.Literal(true),
});
export type ScriptWitnessView = Schema.Schema.Type<typeof ScriptWitnessView>;

/** Midgard defines no redeemer decoder, so the bytes are always present and the
 * structured fields are filled only when the generic CBOR decode yields the
 * `[tag, index, data, exUnits]` shape. */
export const RedeemerView = Schema.Struct({
  cborHex: Schema.String,
  tag: Schema.NullOr(Schema.Number),
  purpose: Schema.NullOr(Schema.String),
  index: Schema.NullOr(Schema.Number),
  data: Schema.NullOr(Schema.Unknown),
  exUnits: Schema.NullOr(Schema.Struct({ mem: DecimalString, steps: DecimalString })),
});
export type RedeemerView = Schema.Schema.Type<typeof RedeemerView>;

export const WitnessSummary = Schema.Struct({
  vkeyCount: Schema.Number,
  scriptCount: Schema.Number,
  redeemerCount: Schema.Number,
  scripts: Schema.Array(ScriptWitnessView),
  redeemers: Schema.Array(RedeemerView),
});
export type WitnessSummary = Schema.Schema.Type<typeof WitnessSummary>;

/** A negative quantity is a burn, which is why this is signed. */
export const MintedAsset = Schema.Struct({
  policyId: Schema.String,
  assetName: Schema.String,
  quantity: SignedDecimalString,
});
export type MintedAsset = Schema.Schema.Type<typeof MintedAsset>;

export const MintView = Schema.Struct({
  policyIds: Schema.Array(Schema.String),
  assets: Schema.Array(MintedAsset),
});
export type MintView = Schema.Schema.Type<typeof MintView>;

export const CapabilityView = Schema.Struct({
  state: Schema.Literal(
    "available",
    "not_present",
    "hash_only",
    "not_supported",
    "not_emitted",
    "not_indexed",
    "commitment_only",
  ),
  reason: Schema.String,
});
export type CapabilityView = Schema.Schema.Type<typeof CapabilityView>;

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
  referenceInputs: Schema.Array(InputView),
  outputs: Schema.Array(OutputView),
  mint: Schema.NullOr(MintView),
  requiredObservers: Schema.Array(Schema.String),
  requiredSigners: Schema.Array(Schema.String),
  scriptIntegrityHash: Schema.NullOr(Schema.String),
  auxiliaryDataHash: Schema.NullOr(Schema.String),
  capabilities: Schema.Struct({
    collateral: CapabilityView,
    metadata: CapabilityView,
    certificates: CapabilityView,
    withdrawals: CapabilityView,
    governance: CapabilityView,
    protocolEvents: CapabilityView,
    executionTrace: CapabilityView,
    consumedBy: CapabilityView,
  }),
  witnesses: WitnessSummary,
  /** Carried only by the single-transaction route; list rows leave it null. */
  cborHex: Schema.NullOr(Schema.String),
  /** True when `cborHex` was cut at the inline cap, so a shortened hex string
   * is never mistaken for a complete one. */
  cborTruncated: Schema.Boolean,
  size: Schema.Number,
  /** True while the tx is still in the mempool. */
  pending: Schema.optional(Schema.Boolean),
});
export type TransactionView = Schema.Schema.Type<typeof TransactionView>;

export const TransactionWithMeta = Schema.Struct({
  ...TransactionView.fields,
  timestamp: IsoTimestamp,
});
export type TransactionWithMeta = Schema.Schema.Type<typeof TransactionWithMeta>;
