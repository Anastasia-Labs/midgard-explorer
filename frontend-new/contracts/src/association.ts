import { Schema } from "effect";
import { Hash28, Hash32, IsoTimestamp } from "./primitives";

/**
 * Cross-layer relationships, and the context needed to read one honestly.
 *
 * Everything here is defined exactly once and composed. The five relationship
 * kinds share `associationFields` by spreading rather than by repeating six
 * lines each, and a response gains the whole envelope through
 * `Schema.extend(X, AssociationEnvelope)`. The previous shape of this problem
 * was the same relationship expressed differently in `inclusion.header_hash`,
 * `finalization.submitted_tx_hash`, `deposit_l1_tx_hash`,
 * `withdrawal_l1_tx_hash`, `tx_order_l1_tx_hash` and `L1BlockHeader.l1TxHash`,
 * with nothing saying they were the same idea.
 */

/**
 * Where L2 rows physically came from.
 *
 * This replaces the database-name heuristic, which named live by exclusion and
 * therefore reported a restored snapshot of real data as a test fixture. Those
 * are different claims: a snapshot is real and possibly stale, a fixture is
 * synthetic and never was true.
 */
export const SourceKind = Schema.Literal("primary", "replica", "snapshot", "fixture");
export type SourceKind = Schema.Schema.Type<typeof SourceKind>;

/**
 * How current a source is, as a state rather than as a number a reader has to
 * interpret. `fixed` is a snapshot, which does not advance and is not stale for
 * failing to; `synthetic` is fixture data, which has no relationship to time.
 */
export const FreshnessState = Schema.Literal(
  "live",
  "lagging",
  "stale",
  "fixed",
  "synthetic",
  "unknown",
);
export type FreshnessState = Schema.Schema.Type<typeof FreshnessState>;

export const Freshness = Schema.Struct({
  state: FreshnessState,
  /** When this source last had something true to say. Null when unknown. */
  observedAsOf: Schema.NullOr(IsoTimestamp),
  /**
   * A measured time lag, when one exists. Null on a replica, always.
   *
   * Everything a standby can observe measures it against ITSELF: it can prove
   * it replayed what it received, and not that it received what the primary
   * produced. A real figure needs the primary's WAL position or a heartbeat the
   * primary writes, so a standby reports its state and its last replay time,
   * and never a number of seconds behind the chain.
   */
  lagSeconds: Schema.NullOr(Schema.Number),
});
export type Freshness = Schema.Schema.Type<typeof Freshness>;

/**
 * Which deployment a response describes, and how much of that is proven.
 *
 * `identityState` is `degraded` when the manifest could not be read or the
 * binding could not be confirmed. A consumer must treat a degraded context the
 * way it treats a missing one: as unverified, never as live.
 */
export const DeploymentContext = Schema.Struct({
  deploymentId: Schema.NullOr(Schema.String),
  network: Schema.String,
  networkMagic: Schema.NullOr(Schema.Number),
  database: Schema.String,
  sourceKind: SourceKind,
  identityState: Schema.Literal("verified", "degraded"),
  freshness: Freshness,
});
export type DeploymentContext = Schema.Schema.Type<typeof DeploymentContext>;

/** Which record an observation came from. Derived links must never be presented
 * as stronger than the source that produced them. */
export const EvidenceSource = Schema.Literal(
  "midgard_finalization_journal",
  "midgard_bridge_record",
  "cardano_l1_index",
  "deployment_manifest",
);
export type EvidenceSource = Schema.Schema.Type<typeof EvidenceSource>;

export const CardanoEvidence = Schema.Struct({
  source: EvidenceSource,
  transactionHash: Schema.NullOr(Hash32),
  outputIndex: Schema.NullOr(Schema.Number),
  blockHeight: Schema.NullOr(Schema.Number),
  observedAt: Schema.NullOr(IsoTimestamp),
  /** The source's own word for its state, unmapped. */
  rawState: Schema.NullOr(Schema.String),
});
export type CardanoEvidence = Schema.Schema.Type<typeof CardanoEvidence>;

/**
 * What comparing the node against the index produced.
 *
 * `mismatch` is reserved for two sources that were both verified and both fresh
 * enough to compare. An index that is merely behind yields `stale`, and one that
 * could not be read yields `unavailable`. Without that separation, ordinary
 * replication lag would raise a false integrity alarm and discredit the
 * mechanism that exists to report real ones.
 */
export const Reconciliation = Schema.Literal(
  "matched",
  "node_only",
  "index_only",
  "mismatch",
  "stale",
  "unavailable",
  "none",
);
export type Reconciliation = Schema.Schema.Type<typeof Reconciliation>;

/**
 * Why two sources could not be compared, when they could not.
 *
 * `stale` carries four quite different situations, and calling all of them "the
 * index is too far behind" is true of exactly one. An index that never
 * completed a pass is not behind; a deployment whose identity is unverified is
 * not behind; a snapshot is not behind, it is fixed. The backend is the only
 * side that can tell them apart, because the interface has the L2 deployment
 * context and neither the index's freshness nor the identity check.
 *
 * Optional so a frontend built against this still parses a backend that
 * predates it.
 */
export const Comparability = Schema.Literal(
  "comparable",
  "index_lagging",
  "index_freshness_unknown",
  "identity_unverified",
  "l2_source_not_current",
);
export type Comparability = Schema.Schema.Type<typeof Comparability>;

/**
 * Settlement states, taken from the node's own vocabulary rather than invented
 * alongside it. The node's six are its `pending_block_finalizations.status`
 * check constraint verbatim. `orphaned` is added because it is an explorer
 * observation the node has no state for, and `unknown` preserves a status this
 * build does not recognise instead of mapping it onto the nearest one.
 */
export const SettlementState = Schema.Literal(
  "pending_submission",
  "submitted_local_finalization_pending",
  "submitted_unconfirmed",
  "observed_waiting_stability",
  "finalized",
  "abandoned",
  "orphaned",
  "unknown",
);
export type SettlementState = Schema.Schema.Type<typeof SettlementState>;

/**
 * Carried by every relationship. Spread into each kind rather than extended, so
 * the resulting struct is flat and Schema infers it without a generic helper in
 * the way.
 *
 * The two `ObservedAsOf` fields exist because L2 and L1 live in different
 * databases and can never share one snapshot. A single `observedAt` would imply
 * a consistency the architecture cannot provide.
 */
const associationFields = {
  deploymentId: Schema.NullOr(Schema.String),
  network: Schema.String,
  reconciliation: Reconciliation,
  comparability: Schema.optional(Comparability),
  l2ObservedAsOf: Schema.NullOr(IsoTimestamp),
  l1ObservedAsOf: Schema.NullOr(IsoTimestamp),
  evidence: Schema.Array(CardanoEvidence),
};

/** A block committed to Cardano by one settlement transaction. */
export const BlockSettlement = Schema.Struct({
  ...associationFields,
  kind: Schema.Literal("block_settlement"),
  l2BlockHeaderHash: Hash28,
  l1TxHash: Schema.NullOr(Hash32),
  state: SettlementState,
});
export type BlockSettlement = Schema.Schema.Type<typeof BlockSettlement>;

/**
 * An L2 transaction, settled through the block that carries it.
 *
 * `l1TxHash` is the block's settlement transaction and not an L1 representation
 * of this transaction, which does not exist. Many L2 transactions share one
 * value here.
 */
export const L2TransactionSettlement = Schema.Struct({
  ...associationFields,
  kind: Schema.Literal("l2_transaction_settlement"),
  l2TxId: Hash32,
  l2BlockHeaderHash: Schema.NullOr(Hash28),
  l1TxHash: Schema.NullOr(Hash32),
  state: SettlementState,
});
export type L2TransactionSettlement = Schema.Schema.Type<typeof L2TransactionSettlement>;

/** Where deposited funds came from. Provenance, not settlement. */
export const DepositOrigin = Schema.Struct({
  ...associationFields,
  kind: Schema.Literal("deposit_origin"),
  l1TxHash: Hash32,
  l1OutputIndex: Schema.NullOr(Schema.Number),
  l2TxId: Schema.NullOr(Hash32),
});
export type DepositOrigin = Schema.Schema.Type<typeof DepositOrigin>;

/** Where a withdrawal was requested. Not where a payout landed. */
export const WithdrawalRequest = Schema.Struct({
  ...associationFields,
  kind: Schema.Literal("withdrawal_request"),
  l1TxHash: Hash32,
  l1OutputIndex: Schema.NullOr(Schema.Number),
  l2OutRef: Schema.NullOr(Schema.String),
});
export type WithdrawalRequest = Schema.Schema.Type<typeof WithdrawalRequest>;

/** Where a forced transaction was ordered. */
export const ForcedTransactionOrder = Schema.Struct({
  ...associationFields,
  kind: Schema.Literal("forced_transaction_order"),
  l1TxHash: Hash32,
  l1OutputIndex: Schema.NullOr(Schema.Number),
  l2TxId: Schema.NullOr(Hash32),
});
export type ForcedTransactionOrder = Schema.Schema.Type<typeof ForcedTransactionOrder>;

export const Association = Schema.Union(
  BlockSettlement,
  L2TransactionSettlement,
  DepositOrigin,
  WithdrawalRequest,
  ForcedTransactionOrder,
);
export type Association = Schema.Schema.Type<typeof Association>;

/**
 * The envelope a detail response gains, applied with
 * `Schema.extend(Existing, AssociationEnvelope)`.
 *
 * One line per response rather than the same two fields written out six times.
 * Both are optional so a frontend built against this still parses a backend that
 * predates it, which is what keeps the rollout additive for one release.
 */
export const AssociationEnvelope = Schema.Struct({
  midgard: Schema.optional(DeploymentContext),
  cardano: Schema.optional(Schema.NullOr(Association)),
});
export type AssociationEnvelope = Schema.Schema.Type<typeof AssociationEnvelope>;

export const decodeAssociation = Schema.decodeUnknownSync(Association);
export const decodeDeploymentContext = Schema.decodeUnknownSync(DeploymentContext);
