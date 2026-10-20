import { Schema } from "effect";
import { Hash28, Hash32, IsoTimestamp, StatusString } from "./primitives";

/** Midgard's state queue, as the node's own follower records it.
 *
 * The queue is a linked list on Cardano: the confirmed state's header first,
 * then every committed header waiting to merge into it, oldest to newest. The
 * node keeps one row per landed header until its merge is folded into the
 * confirmed ledger, so those rows, walked from the confirmed header by their
 * parent links, are the queue. Order comes from the links, never from times.
 *
 * Long queues are windowed: the oldest few and the newest few in full, with
 * `hidden` counting the linked headers between them.
 */

export const QueueBlock = Schema.Struct({
  headerHash: Hash28,
  /** The header this one builds on: the queue's link. */
  parentHeaderHash: Hash28,
  /** Made by this node, or by another operator and replayed from its payload. */
  origin: Schema.Literal("own", "foreign"),
  transactions: Schema.Number,
  deposits: Schema.Number,
  withdrawals: Schema.Number,
  forcedTransactions: Schema.Number,
  /** When the node processed the header as landed in the queue. */
  processedAt: IsoTimestamp,
  /** When the header was committed, from this node's journal. Null for
   * another operator's block, whose commit this node did not make. */
  blockTime: Schema.NullOr(IsoTimestamp),
  /** The Cardano transaction that committed it, for this node's blocks. */
  commitTxHash: Schema.NullOr(Hash32),
});
export type QueueBlock = Schema.Schema.Type<typeof QueueBlock>;

/** A header this node is committing that has not landed in the queue yet. */
export const QueueCommit = Schema.Struct({
  headerHash: Hash28,
  /** A block finalization status from the node's commit journal. */
  status: StatusString,
  blockTime: IsoTimestamp,
});
export type QueueCommit = Schema.Schema.Type<typeof QueueCommit>;

export const StateQueueResponse = Schema.Struct({
  observedAt: IsoTimestamp,
  /** The header the confirmed ledger holds. Null before the first merge. */
  confirmed: Schema.NullOr(Schema.Struct({ headerHash: Hash28, updatedAt: IsoTimestamp })),
  /** Landed headers waiting to merge, as the node counts them. */
  depth: Schema.Number,
  /** How many of them the walk from the confirmed header reached. Less than
   * `depth` means a link is missing, so the order shown is partial. */
  linked: Schema.Number,
  oldest: Schema.Array(QueueBlock),
  newest: Schema.Array(QueueBlock),
  /** Linked headers between `oldest` and `newest`, not listed. */
  hidden: Schema.Number,
  /** This node's commit on its way to the queue. The node runs one at a
   * time: its journal allows a single active commit. */
  committing: Schema.NullOr(QueueCommit),
  /** Landed headers the node recorded as removed from the queue. */
  removed: Schema.Number,
  /** The most recently removed of them, newest first. */
  removedBlocks: Schema.Array(QueueBlock),
  /** The deployment's block maturity, from its manifest. A queued header may
   * merge only once this long has passed since its commit, and only if its
   * data checks also pass. Null when the manifest does not state it. */
  maturityMs: Schema.NullOr(Schema.Number),
});
export type StateQueueResponse = Schema.Schema.Type<typeof StateQueueResponse>;

export const decodeStateQueue = Schema.decodeUnknownSync(StateQueueResponse);
