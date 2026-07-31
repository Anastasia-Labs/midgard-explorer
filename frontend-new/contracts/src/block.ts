import { Schema } from "effect";
import { HexString, IsoTimestamp, paged } from "./primitives";
import { TransactionView } from "./transaction-view";

export const BlockTxRow = Schema.Struct({
  height: Schema.Number,
  header_hash: HexString,
  tx_id: HexString,
  time_stamp_tz: IsoTimestamp,
  transaction: Schema.NullOr(TransactionView),
  decodeError: Schema.NullOr(Schema.String),
});
export type BlockTxRow = Schema.Schema.Type<typeof BlockTxRow>;

/** Data-availability payload committed with the block. */
export const BlockDa = Schema.Struct({
  utxos_root: Schema.String,
  transactions_root: Schema.String,
  deposits_root: Schema.String,
  withdrawals_root: Schema.String,
  forced_transactions_root: Schema.String,
  transition_trace_root: Schema.String,
  event_to_step_root: Schema.String,
  l2_transaction_count: Schema.Number,
  deposit_count: Schema.Number,
  withdrawal_count: Schema.Number,
  forced_transaction_count: Schema.Number,
  total_event_count: Schema.Number,
  transition_step_count: Schema.Number,
  block_start_time: IsoTimestamp,
  block_end_time: IsoTimestamp,
});
export type BlockDa = Schema.Schema.Type<typeof BlockDa>;

/** L1 settlement state; `submitted_tx_hash` is the Cardano anchoring transaction. */
export const BlockFinalization = Schema.Struct({
  status: Schema.String,
  submitted_tx_hash: Schema.NullOr(HexString),
});
export type BlockFinalization = Schema.Schema.Type<typeof BlockFinalization>;

export const BlockResponse = Schema.Struct({
  rows: Schema.Array(BlockTxRow),
  da: Schema.NullOr(BlockDa),
  finalization: Schema.NullOr(BlockFinalization),
});
export type BlockResponse = Schema.Schema.Type<typeof BlockResponse>;

export const RecentBlockRow = Schema.Struct({
  height: Schema.Number,
  header_hash: HexString,
  tx_id: HexString,
  time_stamp_tz: IsoTimestamp,
});
export type RecentBlockRow = Schema.Schema.Type<typeof RecentBlockRow>;

export const RecentBlocksResponse = Schema.Struct({
  rows: Schema.Array(RecentBlockRow),
});
export type RecentBlocksResponse = Schema.Schema.Type<typeof RecentBlocksResponse>;

export const TotalResponse = Schema.Struct({
  total: Schema.Number,
});
export type TotalResponse = Schema.Schema.Type<typeof TotalResponse>;

export const BlocksPageRow = Schema.Struct({
  header_hash: HexString,
  time_stamp_tz: IsoTimestamp,
});
export type BlocksPageRow = Schema.Schema.Type<typeof BlocksPageRow>;

export const BlocksPageResponse = paged(BlocksPageRow);
export type BlocksPageResponse = Schema.Schema.Type<typeof BlocksPageResponse>;

export const decodeBlockResponse = Schema.decodeUnknownSync(BlockResponse);
export const decodeRecentBlocks = Schema.decodeUnknownSync(RecentBlocksResponse);
export const decodeTotal = Schema.decodeUnknownSync(TotalResponse);
export const decodeBlocksPage = Schema.decodeUnknownSync(BlocksPageResponse);
