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

export type OutputView = {
  /** bech32, computed with Midgard protected-header awareness (not @emurgo CSL). */
  address: string;
  value: ValueView;
  hasDatum: boolean;
  hasScriptRef: boolean;
};

export type InputView = OutRef & {
  /**
   * Resolved spend side. Filled in Phase 3 via a ledger lookup; `null` when the
   * input cannot be resolved (e.g. already spent / pruned from the ledger tables).
   */
  resolved: { address: string; value: ValueView } | null;
};

export type WitnessSummary = {
  vkeyCount: number;
  scriptCount: number;
  redeemerCount: number;
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
  referenceInputs: OutRef[];
  outputs: OutputView[];
  mint: { policyIds: string[] } | null;
  witnesses: WitnessSummary;
};
