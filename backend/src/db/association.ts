import type { L2FreshnessState, L2SourceKind } from "./source";

/**
 * Cross-layer relationships, derived once.
 *
 * Every route used to express the same idea differently: `inclusion.header_hash`
 * on a transaction, `finalization.submitted_tx_hash` on a block,
 * `deposit_l1_tx_hash` on a deposit, `withdrawal_l1_tx_hash` on a withdrawal,
 * `tx_order_l1_tx_hash` on a forced transaction, `L1BlockHeader.l1TxHash` in the
 * index. Six spellings, one relationship, and nothing saying so.
 *
 * This module is where that relationship is decided. The routes hand it records
 * and render what comes back. Nothing here reads a database, so the whole thing
 * is testable without one, which is what the reconciliation rules need: they are
 * arithmetic over two observations and a clock, and they must not require a
 * running node to prove.
 *
 * The shape mirrors `@midgard-explorer/contracts/association` exactly. The
 * backend cannot import it (separate workspace, zod here and Effect Schema
 * there), so the wire shape is constructed in this one place rather than
 * assembled inline in six routes, which is the same reason the catalogue exists.
 */

export type Reconciliation =
  "matched" | "node_only" | "index_only" | "mismatch" | "stale" | "unavailable" | "none";

/** The node's own six, plus two the explorer can observe that it cannot. */
export type SettlementState =
  | "pending_submission"
  | "submitted_local_finalization_pending"
  | "submitted_unconfirmed"
  | "observed_waiting_stability"
  | "finalized"
  | "abandoned"
  | "orphaned"
  | "unknown";

const NODE_STATES = new Set<SettlementState>([
  "pending_submission",
  "submitted_local_finalization_pending",
  "submitted_unconfirmed",
  "observed_waiting_stability",
  "finalized",
  "abandoned",
]);

/** An unrecognised status is preserved as `unknown` rather than mapped onto the
 * nearest known one, which would assert protocol knowledge this build lacks. */
export const settlementState = (raw: string | null | undefined): SettlementState =>
  raw !== null && raw !== undefined && NODE_STATES.has(raw as SettlementState)
    ? (raw as SettlementState)
    : "unknown";

export type EvidenceSource =
  | "midgard_finalization_journal"
  | "midgard_bridge_record"
  | "cardano_l1_index"
  | "deployment_manifest";

export type CardanoEvidence = {
  source: EvidenceSource;
  transactionHash: string | null;
  outputIndex: number | null;
  blockHeight: number | null;
  observedAt: string | null;
  rawState: string | null;
};

export type DeploymentContext = {
  deploymentId: string | null;
  network: string;
  networkMagic: number | null;
  database: string;
  sourceKind: L2SourceKind;
  identityState: "verified" | "degraded";
  freshness: {
    state: L2FreshnessState;
    observedAsOf: string | null;
    lagSeconds: number | null;
  };
};

type Common = {
  deploymentId: string | null;
  network: string;
  reconciliation: Reconciliation;
  l2ObservedAsOf: string | null;
  l1ObservedAsOf: string | null;
  evidence: CardanoEvidence[];
  /** Why the two sources could not be compared, or `comparable`. Carried on
   * every relationship so the interface can say which of four quite different
   * situations produced a one-sided or unresolved answer. */
  comparability: Comparability;
};

export type Association =
  | (Common & {
      kind: "block_settlement";
      l2BlockHeaderHash: string;
      l1TxHash: string | null;
      state: SettlementState;
    })
  | (Common & {
      kind: "l2_transaction_settlement";
      l2TxId: string;
      l2BlockHeaderHash: string | null;
      l1TxHash: string | null;
      state: SettlementState;
    })
  | (Common & {
      kind: "deposit_origin";
      l1TxHash: string;
      l1OutputIndex: number | null;
      l2TxId: string | null;
    })
  | (Common & {
      kind: "withdrawal_request";
      l1TxHash: string;
      l1OutputIndex: number | null;
      l2OutRef: string | null;
    })
  | (Common & {
      kind: "forced_transaction_order";
      l1TxHash: string;
      l1OutputIndex: number | null;
      l2TxId: string | null;
    });

/** How stale an L1 observation may be and still be worth comparing. Beyond it,
 * a difference is reported as `stale` rather than as `mismatch`, because an
 * index that has not caught up has not disagreed about anything. */
export const COMPARABLE_WITHIN_SECONDS = 900;

export type SettlementInputs = {
  /** What the node says it submitted. Null when it has recorded no attempt. */
  nodeHash: string | null;
  nodeStatus: string | null;
  nodeObservedAt: string | null;
  /** What the index observed on Cardano. Null when it holds no header for this
   * block, which is silence and not a denial. */
  indexHash: string | null;
  indexObservedAt: string | null;
  indexBlockHeight: number | null;
  /** Whether the L1 index could be read at all. False makes every verdict
   * `unavailable`, because an unreadable source cannot disagree. */
  indexAvailable: boolean;
  /**
   * Whether this process has CONFIRMED that both sources describe the same
   * deployment, which for the index means a binding that agrees with the loaded
   * manifest.
   *
   * Without it a difference is not evidence of a problem: two sources reading
   * two deployments are supposed to name different transactions, and calling
   * that a mismatch would raise an integrity alarm about a configuration
   * mistake. `mismatch` requires this to be true, which is what the contract
   * always said and what the code did not check.
   */
  identityVerified: boolean;
  /** Seconds the index is behind the chain. Null when unknown. */
  indexLagSeconds: number | null;
  /**
   * How current the L2 SOURCE is, which decides what a node silence is worth.
   *
   * A snapshot is a point in time: a finalization it does not hold may exist on
   * the live node, so "the node recorded no attempt" is a claim about the copy
   * rather than about Midgard. Reporting `index_only` from one states as fact
   * something only the live node can settle.
   */
  nodeFreshness: L2FreshnessState;
};

/**
 * Why two sources could not be compared, when they could not.
 *
 * `stale` used to carry all of these, and the interface explained every one of
 * them as "the index is too far behind", which is true of exactly one. An index
 * that never completed a pass is not behind; a deployment whose identity is
 * unverified is not behind either; and a snapshot is not behind, it is fixed.
 */
export type Comparability =
  | "comparable"
  | "index_lagging"
  | "index_freshness_unknown"
  | "identity_unverified"
  | "l2_source_not_current";

/** Whether an ABSENCE in the node's records is a fact about Midgard rather than
 * about a copy of it. `synthetic` qualifies: fixture data is the whole world of
 * a fixture deployment. A snapshot does not, and neither does a standby that is
 * behind or whose currency could not be established. */
export const nodeSilenceIsAboutMidgard = (freshness: L2FreshnessState): boolean =>
  freshness === "live" || freshness === "synthetic";

export function comparability(inputs: SettlementInputs): Comparability {
  if (!inputs.identityVerified) return "identity_unverified";
  if (inputs.indexLagSeconds === null) return "index_freshness_unknown";
  if (inputs.indexLagSeconds > COMPARABLE_WITHIN_SECONDS) return "index_lagging";
  if (!nodeSilenceIsAboutMidgard(inputs.nodeFreshness)) return "l2_source_not_current";
  return "comparable";
}

/**
 * Which of the two sources saw what, and whether they agree.
 *
 * `mismatch` is deliberately hard to reach. It requires both sources present,
 * the index readable, and the index fresh enough that a difference means
 * something. Ordinary replication or indexing lag produces `stale`, because
 * reporting it as a mismatch would fire a false integrity alarm on every quiet
 * hour and teach a reader to ignore the one that matters.
 */
export function reconcile(inputs: SettlementInputs): Reconciliation {
  // An unreadable index is silence, whatever the node says. This used to return
  // `node_only` when a node hash was present, which claims the index was read
  // and held nothing; it was not read at all. The node's evidence is still
  // carried, so nothing is lost by saying so accurately.
  if (!inputs.indexAvailable) return "unavailable";

  // The freshness and identity every verdict below depends on. The INDEX's own
  // freshness is part of it, which is why this lives here and not in the
  // interface: the frontend has only the L2 deployment context, so the same
  // test written there would read the node's freshness and call the Cardano
  // index current because the node was.
  const reason = comparability(inputs);

  // Neither source named a transaction. `none` reads as "nothing has been
  // submitted for this record", which is a positive claim about BOTH of them,
  // and two silences support it only when both sources were in a position to
  // speak. An index that has never completed a pass, read beside a snapshot
  // taken before the block settled, is two absences that establish nothing.
  // This returned `none` for exactly that pair, before any freshness rule below
  // was reached.
  if (inputs.nodeHash === null && inputs.indexHash === null) {
    return reason === "comparable" ? "none" : "stale";
  }

  // A one-sided answer is a CLAIM about the side that is silent, and it is only
  // worth making when that side was in a position to answer.
  //
  // `node_only` used to be returned the moment the index had no row, whatever
  // state the index was in, and the interface then explained it as index lag.
  // An index that has never completed a pass has no lag to speak of and no
  // coverage either; saying "not yet seen on Cardano" about it describes a
  // comparison that did not happen. `stale` is the honest answer there: the
  // sources were not comparable.

  // An INDEX silence needs the index current and identified. The L2 source's
  // own currency is irrelevant to it: the node answered.
  if (inputs.indexHash === null) {
    return reason === "comparable" || reason === "l2_source_not_current" ? "node_only" : "stale";
  }

  // A NODE silence needs the node to have been in a position to speak. Read
  // from a snapshot it was not: the live node may hold a finalization the copy
  // predates, so `index_only` would state as fact something only the live node
  // can settle.
  if (inputs.nodeHash === null) return reason === "comparable" ? "index_only" : "stale";

  if (inputs.nodeHash === inputs.indexHash) return "matched";

  // The two disagree. Calling that a mismatch requires having established BOTH
  // that they describe the same deployment and that the index is fresh enough
  // for a difference to mean something.
  //
  // Unknown freshness is NOT fresh. The previous rule treated a null lag as
  // comparable, and the lag was null or zero in every real case, so `stale` was
  // unreachable and every lagging disagreement was promoted to a false
  // integrity alarm. `stale` now covers both "known to be behind" and "freshness
  // could not be established", which are the same thing to a reader: not
  // comparable.
  // A disagreement is only a disagreement between sources that can be compared.
  // The L2 source's own currency does not enter here: both sources named a
  // transaction, so neither is silent, and a snapshot's hash is as real as a
  // primary's.
  return reason === "comparable" || reason === "l2_source_not_current" ? "mismatch" : "stale";
}

/** Reconciliations in which the two sources named different transactions.
 * Neither may hand back a single actionable hash. */
const DISAGREEMENTS: ReadonlySet<Reconciliation> = new Set(["mismatch", "stale"]);

/** Both observations, always. Neither is dropped when they disagree, because
 * the disagreement is the finding and a response that kept one would hide it. */
export function settlementEvidence(inputs: SettlementInputs): CardanoEvidence[] {
  const evidence: CardanoEvidence[] = [];
  if (inputs.nodeHash !== null || inputs.nodeStatus !== null) {
    evidence.push({
      source: "midgard_finalization_journal",
      transactionHash: inputs.nodeHash,
      outputIndex: null,
      blockHeight: null,
      observedAt: inputs.nodeObservedAt,
      rawState: inputs.nodeStatus,
    });
  }
  if (inputs.indexHash !== null) {
    evidence.push({
      source: "cardano_l1_index",
      transactionHash: inputs.indexHash,
      outputIndex: null,
      blockHeight: inputs.indexBlockHeight,
      observedAt: inputs.indexObservedAt,
      rawState: null,
    });
  }
  return evidence;
}

/**
 * The transaction hash a consumer may act on.
 *
 * Null on a mismatch by design. Two sources naming different transactions is
 * not a question the API gets to settle by preferring one, and a caller handed
 * a single hash would never know a second existed. The evidence carries both.
 */
export function resolvedHash(
  reconciliation: Reconciliation,
  inputs: SettlementInputs,
): string | null {
  // A stale disagreement is still a disagreement. This nulled only `mismatch`,
  // so two sources naming different transactions handed back the index's hash
  // as the single actionable answer whenever freshness was unverified, which is
  // the case the resolver is least entitled to an opinion on.
  if (DISAGREEMENTS.has(reconciliation)) return null;
  return inputs.indexHash ?? inputs.nodeHash;
}

type Identity = { deploymentId: string | null; network: string; l2ObservedAsOf: string | null };

const common = (
  identity: Identity,
  inputs: SettlementInputs,
  reconciliation: Reconciliation,
  /** Overridden only where the verdict was reached without consulting the
   * index, so the general ordering would name a reason that had no part in it. */
  reason: Comparability = comparability(inputs),
): Common => ({
  deploymentId: identity.deploymentId,
  network: identity.network,
  reconciliation,
  l2ObservedAsOf: identity.l2ObservedAsOf,
  l1ObservedAsOf: inputs.indexObservedAt,
  evidence: settlementEvidence(inputs),
  // Carried, not inferred downstream. The interface cannot work this out: it
  // has the L2 deployment context and not the index's freshness or the
  // deployment identity check.
  comparability: reason,
});

/** A block, and the Cardano transaction that committed it. */
export function blockSettlement(
  identity: Identity,
  headerHash: string,
  inputs: SettlementInputs,
): Association {
  const reconciliation = reconcile(inputs);
  return {
    ...common(identity, inputs, reconciliation),
    kind: "block_settlement",
    l2BlockHeaderHash: headerHash,
    l1TxHash: resolvedHash(reconciliation, inputs),
    state: settlementState(inputs.nodeStatus),
  };
}

/**
 * An L2 transaction, settled through the block that carries it.
 *
 * The hash is the block's settlement transaction and not an L1 representation
 * of this transaction, which does not exist. Many L2 transactions share one
 * value here, and nothing about that changes the L1 identity.
 */
export function transactionSettlement(
  identity: Identity,
  txId: string,
  headerHash: string | null,
  inputs: SettlementInputs,
): Association {
  // A transaction in no block has no settlement to reconcile: nothing is keyed
  // by a header that does not exist, so the index is never consulted and its
  // freshness has no part in the answer. The node's ledger is the only source
  // that can say "in no block", which makes this a claim about the L2 source
  // alone, and a copy cannot support it: the live node may have included the
  // transaction after the snapshot was taken.
  const { reconciliation, reason } =
    headerHash !== null
      ? { reconciliation: reconcile(inputs), reason: comparability(inputs) }
      : nodeSilenceIsAboutMidgard(inputs.nodeFreshness)
        ? { reconciliation: "none" as const, reason: "comparable" as const }
        : { reconciliation: "stale" as const, reason: "l2_source_not_current" as const };
  return {
    ...common(identity, inputs, reconciliation, reason),
    kind: "l2_transaction_settlement",
    l2TxId: txId,
    l2BlockHeaderHash: headerHash,
    l1TxHash: headerHash === null ? null : resolvedHash(reconciliation, inputs),
    state: headerHash === null ? "unknown" : settlementState(inputs.nodeStatus),
  };
}

/**
 * The three bridge relationships.
 *
 * These are provenance, not settlement: a deposit's hash is where the funds came
 * from, a withdrawal's is where the request was made rather than where a payout
 * landed, and a forced transaction's is where the order was placed. They come
 * from one node record each, so there is nothing to reconcile and the verdict is
 * `node_only` rather than `matched`, which would claim a corroboration that was
 * never sought.
 */
const bridge = (
  identity: Identity,
  l1TxHash: string,
  l1OutputIndex: number | null,
  observedAt: string | null,
): Common & { l1TxHash: string; l1OutputIndex: number | null } => ({
  deploymentId: identity.deploymentId,
  network: identity.network,
  reconciliation: "node_only",
  // Provenance, so there is nothing to compare and nothing that failed to
  // compare. The node's record IS the answer here, and saying anything about
  // comparability would describe a second source that was never consulted.
  comparability: "comparable",
  l2ObservedAsOf: identity.l2ObservedAsOf,
  l1ObservedAsOf: null,
  evidence: [
    {
      source: "midgard_bridge_record",
      transactionHash: l1TxHash,
      outputIndex: l1OutputIndex,
      blockHeight: null,
      observedAt,
      rawState: null,
    },
  ],
  l1TxHash,
  l1OutputIndex,
});

export function depositOrigin(
  identity: Identity,
  l1TxHash: string,
  ledgerTxId: string | null,
  observedAt: string | null,
): Association {
  return {
    ...bridge(identity, l1TxHash, null, observedAt),
    kind: "deposit_origin",
    l2TxId: ledgerTxId,
  };
}

export function withdrawalRequest(
  identity: Identity,
  l1TxHash: string,
  l1OutputIndex: number | null,
  l2OutRef: string | null,
  observedAt: string | null,
): Association {
  return {
    ...bridge(identity, l1TxHash, l1OutputIndex, observedAt),
    kind: "withdrawal_request",
    l2OutRef,
  };
}

export function forcedTransactionOrder(
  identity: Identity,
  l1TxHash: string,
  l1OutputIndex: number | null,
  txId: string | null,
  observedAt: string | null,
): Association {
  return {
    ...bridge(identity, l1TxHash, l1OutputIndex, observedAt),
    kind: "forced_transaction_order",
    l2TxId: txId,
  };
}
