/**
 * Backend -> frontend JSON contract for a decoded Midgard transaction.
 *
 * This shape is the API the frontend couples to. Keep it deliberate and versioned.
 *
 * NOTE: every `bigint` field below is serialized as a decimal STRING on the wire by
 * the `bigintStringify` response middleware (see server/server.ts). The frontend
 * should treat those fields as strings.
 */

export type OutRef = { txId: string; index: number };

/** policyIdHex -> assetNameHex -> quantity */
export type AssetMap = Record<string, Record<string, bigint>>;

export type ValueView = { lovelace: bigint; assets: AssetMap };

/**
 * An inline datum carried by an output.
 *
 * Midgard-native datums are always inline (`MidgardDatum` has one variant), so
 * there is no datum-hash case to model here. `json` is nullable on purpose: a
 * datum whose CBOR the codec cannot render must degrade to hex rather than
 * fail the whole response.
 */
export type DatumView = { cborHex: string; json: unknown | null };

/** Language tags the Midgard versioned-script codec recognizes. */
export type ScriptLanguage = "NativeCardano" | "PlutusV3" | "MidgardV1";

export type ScriptRefView = {
  hash: string;
  language: ScriptLanguage;
  cborHex: string;
  source: "reference_output";
  hashVerified: true;
};

/** Whether an address pays a script or a public key. Drives the UTxO flow
 * graph's script/key distinction and the script marker in lists. */
export type AddressKind = "Script" | "PubKey";

export type CredentialView = {
  kind: AddressKind;
  hash: string;
};

export type AddressIdentityView = {
  payment: CredentialView;
  stake: CredentialView | null;
  protected: boolean;
  networkId: number;
};

export type OutputStateView = {
  /** `not_in_current_ledger` is deliberately not called `consumed`: the node
   * keeps no historical outref-to-spender index, so pruning and consumption
   * cannot be distinguished from the current ledger tables alone. */
  status: "unspent" | "not_in_current_ledger" | "unknown";
  consumedBy: OutRef | null;
};

export type OutputView = {
  index: number;
  /** bech32, computed with Midgard protected-header awareness (not @emurgo CSL). */
  address: string;
  addressKind: AddressKind;
  identity: AddressIdentityView;
  value: ValueView;
  /** Kept alongside `datum` so nothing reading the boolean breaks. */
  hasDatum: boolean;
  hasScriptRef: boolean;
  datum: DatumView | null;
  scriptRef: ScriptRefView | null;
  state: OutputStateView;
};

export type InputView = OutRef & {
  /**
   * Resolved spend side. Filled in Phase 3 via a ledger lookup; `null` when the
   * input cannot be resolved (e.g. already spent / pruned from the ledger tables).
   */
  resolved: {
    address: string;
    addressKind: AddressKind;
    identity: AddressIdentityView;
    value: ValueView;
  } | null;
};

export type ScriptWitnessView = {
  hash: string;
  language: ScriptLanguage;
  cborHex: string;
  source: "witness_set";
  hashVerified: true;
};

/**
 * A redeemer as it sits in the witness set.
 *
 * Midgard has no redeemer decoder, so the bytes are always reported and the
 * structured fields are filled only when the generic CBOR decode yields the
 * `[tag, index, data, exUnits]` shape. Anything else stays hex rather than
 * being guessed at.
 */
export type RedeemerView = {
  cborHex: string;
  tag: number | null;
  purpose: string | null;
  index: number | null;
  data: unknown | null;
  exUnits: { mem: bigint; steps: bigint } | null;
};

export type WitnessSummary = {
  vkeyCount: number;
  scriptCount: number;
  redeemerCount: number;
  scripts: ScriptWitnessView[];
  redeemers: RedeemerView[];
};

export type TransactionView = {
  txId: string;
  /** Midgard native tx format version. Only version 1 is supported. */
  formatVersion: number;
  /** e.g. "TxIsValid" | "TxIsInvalid". */
  validity: string;
  fee: bigint;
  /** POSIX-time bounds; `null` means unbounded (the codec's "none" sentinel). */
  validityInterval: { start: bigint | null; end: bigint | null };
  networkId: number | null;
  inputs: InputView[];
  referenceInputs: InputView[];
  outputs: OutputView[];
  mint: MintView | null;
  requiredObservers: string[];
  requiredSigners: string[];
  scriptIntegrityHash: string | null;
  auxiliaryDataHash: string | null;
  capabilities: {
    collateral: CapabilityView;
    metadata: CapabilityView;
    certificates: CapabilityView;
    withdrawals: CapabilityView;
    governance: CapabilityView;
    protocolEvents: CapabilityView;
    executionTrace: CapabilityView;
    consumedBy: CapabilityView;
  };
  witnesses: WitnessSummary;
  /**
   * The transaction's own canonical CBOR, hex encoded, and its size in bytes.
   *
   * Filled only on the single-transaction route: inlining it into every list
   * row would multiply a page response by the size of its transactions. List
   * routes leave `cborHex` null and still report `size`.
   */
  cborHex: string | null;
  /** True when `cborHex` was cut at the inline cap, so a reader never mistakes
   * a shortened hex string for a complete one. */
  cborTruncated: boolean;
  size: number;
};

export type CapabilityView = {
  state:
    | "available"
    | "not_present"
    | "hash_only"
    | "not_supported"
    | "not_emitted"
    | "not_indexed"
    | "commitment_only";
  reason: string;
};

/** A single minted or burned asset. A negative quantity is a burn. */
export type MintedAsset = {
  policyId: string;
  assetName: string;
  quantity: bigint;
};

export type MintView = {
  /** Kept so nothing reading the original field breaks. */
  policyIds: string[];
  assets: MintedAsset[];
};
