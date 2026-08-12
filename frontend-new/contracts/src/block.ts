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
  blockEndTime: IsoTimestamp,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  observedConfirmedAt: Schema.NullOr(IsoTimestamp),
});
export type BlockFinalization = Schema.Schema.Type<typeof BlockFinalization>;

/** The block either side of this one. Null at each end of the chain, and null
 * for both when the chain holds a single block. Heights here are block heights,
 * so they will not be one apart: a height is the lowest row id in its block. */
export const BlockNeighbour = Schema.Struct({
  height: Schema.Number,
  header_hash: Schema.String,
});
export type BlockNeighbour = Schema.Schema.Type<typeof BlockNeighbour>;

export const BlockNeighbours = Schema.Struct({
  prev: Schema.NullOr(BlockNeighbour),
  next: Schema.NullOr(BlockNeighbour),
});
export type BlockNeighbours = Schema.Schema.Type<typeof BlockNeighbours>;

export const BlockResponse = Schema.Struct({
  rows: Schema.Array(BlockTxRow),
  da: Schema.NullOr(BlockDa),
  finalization: Schema.NullOr(BlockFinalization),
  /** Optional so a backend that predates this field still decodes. */
  neighbours: Schema.optional(BlockNeighbours),
});
export type BlockResponse = Schema.Schema.Type<typeof BlockResponse>;

export const RecentBlockRow = Schema.Struct({
  height: Schema.Number,
  header_hash: HexString,
  tx_id: HexString,
  time_stamp_tz: IsoTimestamp,
  tx_count: Schema.Number,
  finalization_status: Schema.NullOr(Schema.String),
});
export type RecentBlockRow = Schema.Schema.Type<typeof RecentBlockRow>;

export const RecentBlocksResponse = Schema.Struct({
  rows: Schema.Array(RecentBlockRow),
});
export type RecentBlocksResponse = Schema.Schema.Type<typeof RecentBlocksResponse>;

/** Height-to-hash resolution for search; the hash is the canonical block key. */
export const BlockByHeightResponse = Schema.Struct({
  header_hash: HexString,
});
export type BlockByHeightResponse = Schema.Schema.Type<typeof BlockByHeightResponse>;

export const TotalResponse = Schema.Struct({
  total: Schema.Number,
});
export type TotalResponse = Schema.Schema.Type<typeof TotalResponse>;

export const BlocksPageRow = Schema.Struct({
  height: Schema.Number,
  header_hash: HexString,
  time_stamp_tz: IsoTimestamp,
  tx_count: Schema.Number,
  /** Null when the node has no finalization record for the block yet. */
  finalization_status: Schema.NullOr(Schema.String),
});
export type BlocksPageRow = Schema.Schema.Type<typeof BlocksPageRow>;

export const BlocksPageResponse = paged(BlocksPageRow);
export type BlocksPageResponse = Schema.Schema.Type<typeof BlocksPageResponse>;

export const decodeBlockResponse = Schema.decodeUnknownSync(BlockResponse);
export const decodeRecentBlocks = Schema.decodeUnknownSync(RecentBlocksResponse);
export const decodeBlockByHeight = Schema.decodeUnknownSync(BlockByHeightResponse);
export const decodeTotal = Schema.decodeUnknownSync(TotalResponse);
export const decodeBlocksPage = Schema.decodeUnknownSync(BlocksPageResponse);
