import { Schema } from "effect";
import { HexString, IsoTimestamp, StatusString, paged } from "./primitives";
import { ValueView } from "./transaction-view";

export const DepositRow = Schema.Struct({
  event_id: HexString,
  deposit_l1_tx_hash: HexString,
  ledger_tx_id: HexString,
  ledger_address: Schema.String,
  status: StatusString,
  inclusion_time: IsoTimestamp,
  projected_header_hash: Schema.NullOr(HexString),
  value: Schema.NullOr(ValueView),
});
export type DepositRow = Schema.Schema.Type<typeof DepositRow>;

export const DepositsPageResponse = paged(DepositRow);
export type DepositsPageResponse = Schema.Schema.Type<typeof DepositsPageResponse>;

export const WithdrawalRow = Schema.Struct({
  event_id: HexString,
  withdrawal_l1_tx_hash: HexString,
  withdrawal_l1_output_index: Schema.Number,
  l2_outref: HexString,
  l2_value: Schema.NullOr(ValueView),
  l2_value_raw: HexString,
  l2_value_decode_error: Schema.NullOr(Schema.String),
  l1_address: HexString,
  l1_address_bech32: Schema.NullOr(Schema.String),
  l1_address_decode_error: Schema.NullOr(Schema.String),
  /** Null until the node has validated the withdrawal (backend: string | null). */
  validity: Schema.NullOr(StatusString),
  status: StatusString,
  inclusion_time: IsoTimestamp,
  projected_header_hash: Schema.NullOr(HexString),
});
export type WithdrawalRow = Schema.Schema.Type<typeof WithdrawalRow>;

export const WithdrawalsPageResponse = paged(WithdrawalRow);
export type WithdrawalsPageResponse = Schema.Schema.Type<typeof WithdrawalsPageResponse>;

export const ForcedTxRow = Schema.Struct({
  tx_order_id: HexString,
  tx_order_l1_tx_hash: HexString,
  tx_order_l1_output_index: Schema.Number,
  tx_id: HexString,
  operator_validity: StatusString,
  status: StatusString,
  inclusion_time: IsoTimestamp,
  projected_header_hash: Schema.NullOr(HexString),
});
export type ForcedTxRow = Schema.Schema.Type<typeof ForcedTxRow>;

export const ForcedTxsPageResponse = paged(ForcedTxRow);
export type ForcedTxsPageResponse = Schema.Schema.Type<typeof ForcedTxsPageResponse>;

export const decodeDepositsPage = Schema.decodeUnknownSync(DepositsPageResponse);
export const decodeWithdrawalsPage = Schema.decodeUnknownSync(WithdrawalsPageResponse);
export const decodeForcedTxsPage = Schema.decodeUnknownSync(ForcedTxsPageResponse);
