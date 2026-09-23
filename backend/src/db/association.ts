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

/**
 * What the node's records say about a Midgard record's Cardano settlement.
 *
 * Three verdicts, and none of them is a comparison. The explorer reads one
 * source, so it can report what that source holds and how much its silence is
 * worth, and nothing else. `matched`, `mismatch`, `index_only` and `stale`
 * described two observations and were removed with the index that produced the
 * second one; the decision and what it costs are in ADR 0009.
 */
export type Reconciliation =
  /** The node named a settlement transaction. Nothing checked it, and no
   * surface built on this may say confirmed. Requires an actual hash. */
  | "node_reported"
  /** The node recorded no settlement transaction, and its own data is current
   * enough for that absence to mean something. */
  | "none"
  /** Nothing could be established: the node's records are a copy that is not
   * known to be current, and hold no hash. */
  | "unavailable";

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
  /** How much is KNOWN about which deployment this is. `configured` means a
   * manifest named it and nothing checked that claim; `unconfigured` means even
   * that could not be read. Neither is a verification, and no surface may
   * present one as such. */
  identityState: "configured" | "unconfigured";
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
  /** When the MIDGARD data behind this answer was current. There is no second
   * timestamp beside it any more: nothing here observes Cardano, so a Cardano
   * "as of" would describe an observation that was never made. */
  l2ObservedAsOf: string | null;
  evidence: CardanoEvidence[];
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

export type SettlementInputs = {
  /** What the node says it submitted. Null when it has recorded no attempt. */
  nodeHash: string | null;
  nodeStatus: string | null;
  nodeObservedAt: string | null;
  /**
   * How current the node's own data is, which decides what its silence is
   * worth.
   *
   * A snapshot is a point in time: a finalization it does not hold may exist on
   * the live node, so "the node recorded no attempt" is a claim about the copy
   * rather than about Midgard, and an absence read from one establishes
   * nothing.
   */
  nodeFreshness: L2FreshnessState;
};

/** Whether an ABSENCE in the node's records is a fact about Midgard rather than
 * about a copy of it. `synthetic` qualifies: fixture data is the whole world of
 * a fixture deployment. A snapshot does not, and neither does a standby that is
 * behind or whose currency could not be established. */
export const nodeSilenceIsAboutMidgard = (freshness: L2FreshnessState): boolean =>
  freshness === "live" || freshness === "synthetic";

/**
 * What the node's records support saying about one settlement.
 *
 * Nothing here compares anything. The explorer reads the node and reports what
 * it holds, which is why a hash is `node_reported` rather than confirmed, and
 * why an absence is only `none` when the records it is absent from are current.
 */
export function reconcile(inputs: SettlementInputs): Reconciliation {
  // `node_reported` is a statement about a hash. Without one there is no
  // settlement evidence to attribute, and saying "reported by the node" about
  // an empty record would invent some.
  if (inputs.nodeHash !== null) return "node_reported";
  // No hash, and the node's own currency decides what that absence is worth.
  return nodeSilenceIsAboutMidgard(inputs.nodeFreshness) ? "none" : "unavailable";
}

/** The node's record, as the node wrote it. One source, so one row, and the
 * row is present whenever the node has anything to say at all. */
export function settlementEvidence(inputs: SettlementInputs): CardanoEvidence[] {
  return inputs.nodeHash === null && inputs.nodeStatus === null
    ? []
    : [
        {
          source: "midgard_finalization_journal",
          transactionHash: inputs.nodeHash,
          outputIndex: null,
          blockHeight: null,
          observedAt: inputs.nodeObservedAt,
          rawState: inputs.nodeStatus,
        },
      ];
}

type Identity = { deploymentId: string | null; network: string; l2ObservedAsOf: string | null };

const common = (
  identity: Identity,
  inputs: SettlementInputs,
  reconciliation: Reconciliation,
): Common => ({
  deploymentId: identity.deploymentId,
  network: identity.network,
  reconciliation,
  l2ObservedAsOf: identity.l2ObservedAsOf,
  evidence: settlementEvidence(inputs),
});

/** A block, and the Cardano transaction the node recorded for it. */
export function blockSettlement(
  identity: Identity,
  headerHash: string,
  inputs: SettlementInputs,
): Association {
  return {
    ...common(identity, inputs, reconcile(inputs)),
    kind: "block_settlement",
    l2BlockHeaderHash: headerHash,
    // The node's hash, or none. There is no second candidate to prefer.
    l1TxHash: inputs.nodeHash,
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
  // A transaction in no block has no settlement to report: the node's ledger is
  // the only source that can say "in no block", and a copy of it cannot, since
  // the live node may have included the transaction after the copy was taken.
  // `reconcile` already applies exactly that rule, because with no header there
  // is no hash either.
  const reconciliation = reconcile(inputs);
  return {
    ...common(identity, inputs, reconciliation),
    kind: "l2_transaction_settlement",
    l2TxId: txId,
    l2BlockHeaderHash: headerHash,
    l1TxHash: headerHash === null ? null : inputs.nodeHash,
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
  // Provenance, not settlement: the node's record IS the answer, and it is
  // reported as the node's. These never had a second source to compare with,
  // so this relationship is unchanged by the index's removal.
  reconciliation: "node_reported",
  l2ObservedAsOf: identity.l2ObservedAsOf,
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
