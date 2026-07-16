// Frontend mirror of the backend decode JSON contract (backend/src/decode/types.ts).
// The backend now decodes Midgard-native transactions and returns this shape; the
// frontend no longer parses CBOR. All bigint amounts arrive as decimal STRINGS.

export type OutRef = { txId: string; index: number };

/** policyIdHex -> assetNameHex -> quantity (decimal string) */
export type AssetMap = Record<string, Record<string, string>>;

export type ValueView = { lovelace: string; assets: AssetMap };

export type OutputView = {
  address: string; // bech32
  value: ValueView;
  hasDatum: boolean;
  hasScriptRef: boolean;
};

export type InputView = OutRef & {
  /** Resolved spend side; null when not resolvable (spent/pruned). */
  resolved: { address: string; value: ValueView } | null;
};

export type WitnessSummary = {
  vkeyCount: number;
  scriptCount: number;
  redeemerCount: number;
};

export type TransactionView = {
  txId: string;
  formatVersion: number;
  validity: string; // "TxIsValid" | "TxIsInvalid"
  fee: string;
  validityInterval: { start: string | null; end: string | null };
  networkId: number | null;
  inputs: InputView[];
  referenceInputs: OutRef[];
  outputs: OutputView[];
  mint: { policyIds: string[] } | null;
  witnesses: WitnessSummary;
  /** True when the tx is still in the mempool (not yet merged into a block). */
  pending?: boolean;
};

/** Back-compat alias: pages historically import `Transaction`. */
export type Transaction = TransactionView;

/** Canonical tx lifecycle status, mirrors the node's `resolveTxStatus` priority. */
export type TxStatus =
  | "committed"
  | "pending_commit"
  | "accepted"
  | "rejected"
  | "validating"
  | "queued";
