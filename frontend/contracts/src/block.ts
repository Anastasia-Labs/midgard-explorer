// Generated from backend/contracts by `pnpm contracts:write` in backend/. Edit the source, not this copy.
import { Schema } from "effect";
import { BlockSettlement, DeploymentContext } from "./association";
import { HexString, IsoTimestamp, paged } from "./primitives";
import { TransactionView } from "./transaction-view";

export const BlockTxRow = Schema.Struct({
  height: Schema.NullOr(Schema.Number),
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

export const BlockHeader = Schema.Struct({
  header_hash: HexString,
  height: Schema.NullOr(Schema.Number),
  block_start_time: Schema.NullOr(IsoTimestamp),
  block_end_time: IsoTimestamp,
  header_l2_transaction_count: Schema.NullOr(Schema.Number),
  header_deposit_count: Schema.NullOr(Schema.Number),
  header_withdrawal_count: Schema.NullOr(Schema.Number),
  header_forced_transaction_count: Schema.NullOr(Schema.Number),
  materialized_l2_transaction_count: Schema.Number,
  payload_retained_locally: Schema.Boolean,
});
export type BlockHeader = Schema.Schema.Type<typeof BlockHeader>;

export const BlockEventMember = Schema.Struct({
  member_id: HexString,
  ordinal: Schema.Number,
  source_time_stamp_tz: IsoTimestamp,
});
export type BlockEventMember = Schema.Schema.Type<typeof BlockEventMember>;

export const BlockEvents = Schema.Struct({
  deposits: Schema.Array(BlockEventMember),
  withdrawals: Schema.Array(BlockEventMember),
  forced_transactions: Schema.Array(BlockEventMember),
});
export type BlockEvents = Schema.Schema.Type<typeof BlockEvents>;

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

/** One Merkle root as the header this block builds on recorded it (`base`) and
 * as this block's header commits to it (`expected`). A root is a commitment,
 * not a proof. `changed` is true when the two differ, false when they are
 * equal, and null when either side is not reported. */
export const RootPair = Schema.Struct({
  base: Schema.NullOr(Schema.String),
  expected: Schema.NullOr(Schema.String),
  changed: Schema.NullOr(Schema.Boolean),
});
export type RootPair = Schema.Schema.Type<typeof RootPair>;

/** The block's commitment set from its finalization journal row. The node
 * records no base for the transition trace or event-to-step root. */
export const BlockCommitments = Schema.Struct({
  utxos: RootPair,
  transactions: RootPair,
  deposits: RootPair,
  withdrawals: RootPair,
  forced_transactions: RootPair,
  transition_trace: RootPair,
  event_to_step: RootPair,
});
export type BlockCommitments = Schema.Schema.Type<typeof BlockCommitments>;

/** The header either side of this one. Null at each end of the chain, and null
 * for both when the chain holds a single header. `height` is only the nullable,
 * legacy `blocks` row identifier retained for backwards compatibility. */
export const BlockNeighbour = Schema.Struct({
  height: Schema.NullOr(Schema.Number),
  header_hash: HexString,
});
export type BlockNeighbour = Schema.Schema.Type<typeof BlockNeighbour>;

export const BlockNeighbours = Schema.Struct({
  prev: Schema.NullOr(BlockNeighbour),
  next: Schema.NullOr(BlockNeighbour),
});
export type BlockNeighbours = Schema.Schema.Type<typeof BlockNeighbours>;

/**
 * Where a block is in the explorer's archive (public source only).
 *
 * `awaiting`: a header the archive knows of, as an archived block's parent or
 * a seed, that no run has fetched. `archiving`: a run started on it recently.
 * `failed`: the last run could not fetch or verify it, for `reason`.
 */
export const ArchiveState = Schema.Struct({
  state: Schema.Literal("awaiting", "archiving", "failed", "archived"),
  at: Schema.NullOr(IsoTimestamp),
  reason: Schema.NullOr(Schema.String),
});
export type ArchiveState = Schema.Schema.Type<typeof ArchiveState>;

/** Where one observation came from, and when. An operator's observation
 * names the operator here: it is provenance, not proof. */
export const Observation = Schema.Struct({
  source: Schema.String,
  chainPoint: Schema.NullOr(Schema.String),
  at: IsoTimestamp,
});
export type Observation = Schema.Schema.Type<typeof Observation>;

/**
 * One fact about a block, stated on its own. `pass` and `fail` are checks this
 * explorer ran; `recorded` is an outcome some source recorded, in `value`;
 * `not_run` is a check that needs an input this source lacks; `unknown` is a
 * fact no observation covers. `reason` is a typed code, never prose, and an
 * unknown fact is never a zero.
 */
export const EvidenceLine = Schema.Struct({
  state: Schema.Literal("pass", "fail", "recorded", "not_run", "unknown", "not_applicable"),
  value: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  observation: Schema.NullOr(Observation),
});
export type EvidenceLine = Schema.Schema.Type<typeof EvidenceLine>;

export const BlockEvidence = Schema.Struct({
  payloadIntegrity: EvidenceLine,
  headerBinding: EvidenceLine,
  roots: EvidenceLine,
  l1Observation: EvidenceLine,
  daStatus: EvidenceLine,
  maturity: EvidenceLine,
  localApplication: EvidenceLine,
  merge: EvidenceLine,
  withdrawalPayment: EvidenceLine,
});
export type BlockEvidence = Schema.Schema.Type<typeof BlockEvidence>;

/**
 * A recorded fate of a header that left the queue. Merged by ancestry names
 * the confirmed header it was read under (`anchor`) and the view that read
 * it, and carries no merge transaction or depth: it was not observed directly.
 */
export const BlockOutcome = Schema.Struct({
  outcome: Schema.Literal("merged", "removed", "unresolved"),
  evidence: Schema.String,
  anchor: Schema.NullOr(HexString),
  view: Schema.NullOr(Schema.String),
  observation: Observation,
});
export type BlockOutcome = Schema.Schema.Type<typeof BlockOutcome>;

/** Which archive page of the block's transactions `rows` holds. */
export const RecordsPage = Schema.Struct({
  page: Schema.Number,
  pages: Schema.Number,
  records: Schema.Number,
});
export type RecordsPage = Schema.Schema.Type<typeof RecordsPage>;

/** A 404 for a header the archive knows of but does not hold. */
export const BlockNotArchived = Schema.Struct({
  error: Schema.String,
  archive: ArchiveState,
});
export type BlockNotArchived = Schema.Schema.Type<typeof BlockNotArchived>;

export const BlockResponse = Schema.Struct({
  /** Which deployment answered, and how current its L2 source is. */
  midgard: Schema.optional(DeploymentContext),
  /** The block's Cardano settlement, reconciled across both sources. Replaces
   * the page's own separate index fetch, which swallowed every failure into a
   * sentence about index lag. */
  /** A block settles, so this is the block-settlement relationship and not the
   * whole union. Accepting every kind here meant a deposit-origin association
   * would decode on a block response, which is a shape the backend never sends
   * and a consumer would have to defend against for no reason. */
  cardano: Schema.optional(BlockSettlement),
  header: BlockHeader,
  rows: Schema.Array(BlockTxRow),
  da: Schema.NullOr(BlockDa),
  finalization: Schema.NullOr(BlockFinalization),
  /** Null when the block has no finalization journal row. Optional so a page
   * deployed ahead of its backend still decodes. */
  commitments: Schema.optional(Schema.NullOr(BlockCommitments)),
  neighbours: BlockNeighbours,
  events: BlockEvents,
  /** Public source only. Optional so pages built before it still decode. */
  archive: Schema.optional(ArchiveState),
  evidence: Schema.optional(BlockEvidence),
  outcome: Schema.optional(Schema.NullOr(BlockOutcome)),
  transactionsPage: Schema.optional(RecordsPage),
});
export type BlockResponse = Schema.Schema.Type<typeof BlockResponse>;

export const RecentBlockRow = Schema.Struct({
  height: Schema.NullOr(Schema.Number),
  header_hash: HexString,
  tx_id: Schema.NullOr(HexString),
  block_start_time: IsoTimestamp,
  block_end_time: IsoTimestamp,
  time_stamp_tz: IsoTimestamp,
  tx_count: Schema.Number,
  header_l2_transaction_count: Schema.Number,
  header_deposit_count: Schema.Number,
  header_withdrawal_count: Schema.Number,
  header_forced_transaction_count: Schema.Number,
  materialized_l2_transaction_count: Schema.Number,
  payload_retained_locally: Schema.Boolean,
  finalization_status: Schema.String,
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
  height: Schema.NullOr(Schema.Number),
  header_hash: HexString,
  block_start_time: IsoTimestamp,
  block_end_time: IsoTimestamp,
  time_stamp_tz: IsoTimestamp,
  tx_count: Schema.Number,
  header_l2_transaction_count: Schema.Number,
  header_deposit_count: Schema.Number,
  header_withdrawal_count: Schema.Number,
  header_forced_transaction_count: Schema.Number,
  materialized_l2_transaction_count: Schema.Number,
  payload_retained_locally: Schema.Boolean,
  finalization_status: Schema.String,
});
export type BlocksPageRow = Schema.Schema.Type<typeof BlocksPageRow>;

export const BlocksPageResponse = paged(BlocksPageRow);
export type BlocksPageResponse = Schema.Schema.Type<typeof BlocksPageResponse>;

export const decodeBlockResponse = Schema.decodeUnknownSync(BlockResponse);
export const decodeBlockNotArchived = Schema.decodeUnknownSync(BlockNotArchived);
export const decodeRecentBlocks = Schema.decodeUnknownSync(RecentBlocksResponse);
export const decodeBlockByHeight = Schema.decodeUnknownSync(BlockByHeightResponse);
export const decodeTotal = Schema.decodeUnknownSync(TotalResponse);
export const decodeBlocksPage = Schema.decodeUnknownSync(BlocksPageResponse);
