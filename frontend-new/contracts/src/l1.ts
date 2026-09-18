import { Schema } from "effect";
import { DeploymentContext } from "./association";
import { Hash28, Hash32, IsoTimestamp, paged } from "./primitives";

/**
 * Midgard's Cardano footprint, as the node recorded it.
 *
 * Every field here comes from the Midgard node's own database or from the
 * deployment manifest. Nothing in this file describes an observation of
 * Cardano, because the explorer no longer makes one: the chain index that did
 * is decommissioned, and ADR 0009 records what that costs.
 *
 * The consequence a consumer has to keep: these rows prove that Midgard
 * RECORDED a transaction, never that Cardano accepted it, and a transaction no
 * Midgard record names cannot appear here at all.
 */

export const ActivityKind = Schema.Literal(
  "settlement",
  "deposit",
  "withdrawal",
  "forced_transaction",
);
export type ActivityKind = Schema.Schema.Type<typeof ActivityKind>;

export const CardanoActivityRow = Schema.Struct({
  kind: ActivityKind,
  l1TxHash: Hash32,
  /** Set where the node records which output of the transaction it read. */
  outputIndex: Schema.NullOr(Schema.Number),
  /** When the NODE recorded this, which is not when Cardano accepted it. */
  recordedAt: IsoTimestamp,
  /** The node's own word for the record's state, unmapped. */
  status: Schema.NullOr(Schema.String),
  /** The Midgard block this belongs to: the block a settlement commits, or the
   * header a bridge event was projected into. */
  headerHash: Schema.NullOr(Hash28),
  /** The event or order id, so a row can link to the record it names. */
  recordId: Schema.NullOr(Schema.String),
});
export type CardanoActivityRow = Schema.Schema.Type<typeof CardanoActivityRow>;

export const CardanoActivityPage = Schema.Struct({
  midgard: DeploymentContext,
  ...paged(CardanoActivityRow).fields,
});
export type CardanoActivityPage = Schema.Schema.Type<typeof CardanoActivityPage>;

export const CardanoActivityKindCount = Schema.Struct({
  kind: ActivityKind,
  count: Schema.Number,
  newestRecordedAt: Schema.NullOr(IsoTimestamp),
});
export type CardanoActivityKindCount = Schema.Schema.Type<typeof CardanoActivityKindCount>;

export const CardanoActivitySummary = Schema.Struct({
  midgard: DeploymentContext,
  total: Schema.Number,
  /** How recent the newest record is. A count with no date reads as current. */
  newestRecordedAt: Schema.NullOr(IsoTimestamp),
  /** Every kind, including the ones with nothing in them. */
  byKind: Schema.Array(CardanoActivityKindCount),
});
export type CardanoActivitySummary = Schema.Schema.Type<typeof CardanoActivitySummary>;

/**
 * What Midgard records about one Cardano transaction.
 *
 * An empty list is a real answer: no Midgard record names this hash. It is not
 * a statement about whether the transaction exists on Cardano, which nothing
 * here can answer.
 */
export const CardanoReferenceResponse = Schema.Struct({
  midgard: DeploymentContext,
  txHash: Hash32,
  references: Schema.Array(CardanoActivityRow),
});
export type CardanoReferenceResponse = Schema.Schema.Type<typeof CardanoReferenceResponse>;

/**
 * A validator this deployment declares.
 *
 * From the manifest, which is configuration. An address here is where the
 * contract lives, not evidence that anything has happened at it.
 */
export const L1ValidatorIdentity = Schema.Struct({
  family: Schema.String,
  purpose: Schema.String,
  scriptHash: Hash28,
  address: Schema.String,
  rewardAddress: Schema.NullOr(Schema.String),
  policyId: Schema.NullOr(Hash28),
  /** A reviewed placeholder rather than a deployed validator. */
  placeholder: Schema.Boolean,
});
export type L1ValidatorIdentity = Schema.Schema.Type<typeof L1ValidatorIdentity>;

export const L1ValidatorsResponse = Schema.Struct({
  midgard: DeploymentContext,
  deploymentId: Schema.String,
  network: Schema.String,
  validators: Schema.Array(L1ValidatorIdentity),
});
export type L1ValidatorsResponse = Schema.Schema.Type<typeof L1ValidatorsResponse>;

export const L1ValidatorResponse = Schema.Struct({
  midgard: DeploymentContext,
  deploymentId: Schema.String,
  network: Schema.String,
  validator: L1ValidatorIdentity,
});
export type L1ValidatorResponse = Schema.Schema.Type<typeof L1ValidatorResponse>;

export const decodeCardanoActivityPage = Schema.decodeUnknownSync(CardanoActivityPage);
export const decodeCardanoActivitySummary = Schema.decodeUnknownSync(CardanoActivitySummary);
export const decodeCardanoReferences = Schema.decodeUnknownSync(CardanoReferenceResponse);
export const decodeL1Validators = Schema.decodeUnknownSync(L1ValidatorsResponse);
export const decodeL1Validator = Schema.decodeUnknownSync(L1ValidatorResponse);
