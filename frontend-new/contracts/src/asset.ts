import { Schema } from "effect";
import { DecimalString, HexString } from "./primitives";

/** Native assets, read from the current ledger.
 *
 * `coverage` is the load-bearing field. Midgard keeps a UTxO's value inside
 * canonical CBOR, so an asset query means decoding outputs rather than filtering
 * rows, and the scan is bounded. Every response therefore says how much of the
 * ledger it looked at, so a partial answer can never be presented as a total.
 */

export const AssetCoverage = Schema.Struct({
  /** Ledger rows decoded for this answer. */
  scanned: Schema.Number,
  /** Spendable ledger rows that exist. */
  total: Schema.Number,
  /** True when `scanned < total`, so the figures below are a lower bound. */
  truncated: Schema.Boolean,
  /** Rows whose value the codec could not read; they contribute nothing. */
  undecoded: Schema.Number,
});
export type AssetCoverage = Schema.Schema.Type<typeof AssetCoverage>;

export const AssetHolder = Schema.Struct({
  address: Schema.String,
  quantity: DecimalString,
  utxoCount: Schema.Number,
});
export type AssetHolder = Schema.Schema.Type<typeof AssetHolder>;

export const AssetResponse = Schema.Struct({
  policyId: HexString,
  assetName: HexString,
  /** Summed over the rows scanned. It is a supply figure only when coverage is
   * complete and untruncated; otherwise it is a lower bound over the live
   * ledger, and never a historical total. */
  ledgerQuantity: DecimalString,
  holderCount: Schema.Number,
  holders: Schema.Array(AssetHolder),
  holdersTruncated: Schema.Boolean,
  coverage: AssetCoverage,
});
export type AssetResponse = Schema.Schema.Type<typeof AssetResponse>;

export const AssetRosterRow = Schema.Struct({
  policyId: HexString,
  assetName: HexString,
  ledgerQuantity: DecimalString,
  holderCount: Schema.Number,
  utxoCount: Schema.Number,
});
export type AssetRosterRow = Schema.Schema.Type<typeof AssetRosterRow>;

export const AssetsResponse = Schema.Struct({
  rows: Schema.Array(AssetRosterRow),
  total: Schema.Number,
  coverage: AssetCoverage,
});
export type AssetsResponse = Schema.Schema.Type<typeof AssetsResponse>;

export const decodeAsset = Schema.decodeUnknownSync(AssetResponse);
export const decodeAssets = Schema.decodeUnknownSync(AssetsResponse);
