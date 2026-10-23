import { describe, expect, it } from "vitest";
import {
  blockSettlement,
  depositOrigin,
  forcedTransactionOrder,
  reconcile,
  settlementEvidence,
  settlementState,
  transactionSettlement,
  withdrawalRequest,
  type Reconciliation,
  type SettlementInputs,
} from "../src/db/association.js";

/**
 * What the explorer may say about settlement, given one source.
 *
 * No database here on purpose. These decisions are the product's central claim,
 * and needing a running node to prove them is how they would go untested.
 *
 * These rules used to arbitrate between the node and an explorer-owned chain
 * index, and most of this file tested that arbitration. The index is
 * decommissioned, so the question is narrower and sharper: the explorer reports
 * what the node recorded, says whose record it is, and never implies that
 * anything checked it. The states that described two observations are gone, and
 * the first test here is what keeps them gone.
 */

const NODE_HASH = "a".repeat(64);
const HEADER = "c".repeat(56);

const identity = {
  deploymentId: "dep",
  network: "preprod",
  l2ObservedAsOf: "2026-09-02T00:00:00Z",
};

const inputs = (over: Partial<SettlementInputs> = {}): SettlementInputs => ({
  nodeHash: NODE_HASH,
  nodeStatus: "finalized",
  nodeObservedAt: "2026-09-02T00:00:00Z",
  // A live node by default, so a case that cares about reading a snapshot or a
  // standby that is behind says so.
  nodeFreshness: "live",
  ...over,
});

describe("reconcile", () => {
  /**
   * The property, over the whole input space rather than case by case.
   *
   * Every combination of the fields a verdict reads, asserted to produce one of
   * exactly three answers. A case-by-case test proves the branches someone
   * thought of; this one fails if a later change reintroduces a verdict that
   * claims a comparison this explorer cannot perform.
   */
  it("can only reach the three verdicts one source supports", () => {
    const allowed = new Set<Reconciliation>(["node_reported", "none", "unavailable"]);
    const freshness = ["live", "synthetic", "fixed", "lagging", "unknown"] as const;
    let checked = 0;
    for (const nodeHash of [null, NODE_HASH]) {
      for (const nodeStatus of [null, "finalized", "pending_submission"]) {
        for (const nodeFreshness of freshness) {
          const verdict = reconcile(inputs({ nodeHash, nodeStatus, nodeFreshness }));
          expect(allowed.has(verdict), `${verdict} from a single source`).toBe(true);
          checked += 1;
        }
      }
    }
    // The loop ran. A sweep that silently iterated nothing would pass every
    // assertion inside it.
    expect(checked).toBe(2 * 3 * 5);
  });

  it("reports the node's record as the node's record", () => {
    expect(reconcile(inputs())).toBe("node_reported");
  });

  /** A record with no hash is not settlement evidence, and `node_reported`
   * would present it as if it were. */
  it("does not report a record with no hash as reported by the node", () => {
    expect(reconcile(inputs({ nodeHash: null, nodeStatus: "pending_submission" }))).toBe("none");
    expect(reconcile(inputs({ nodeHash: null, nodeStatus: null }))).toBe("none");
  });

  /** With one source, an absence is only as good as that source's currency. */
  it("does not turn a copy's silence into a settled absence", () => {
    expect(reconcile(inputs({ nodeHash: null, nodeFreshness: "fixed" }))).toBe("unavailable");
    expect(reconcile(inputs({ nodeHash: null, nodeFreshness: "lagging" }))).toBe("unavailable");
    expect(reconcile(inputs({ nodeHash: null, nodeFreshness: "unknown" }))).toBe("unavailable");
    // Fixture data is the whole world of a fixture deployment, so its silence
    // does establish an absence.
    expect(reconcile(inputs({ nodeHash: null, nodeFreshness: "synthetic" }))).toBe("none");
  });
});

describe("evidence", () => {
  it("carries the node's record, and only the node's", () => {
    const evidence = settlementEvidence(inputs());
    expect(evidence.map((row) => row.source)).toEqual(["midgard_finalization_journal"]);
    expect(evidence[0]?.transactionHash).toBe(NODE_HASH);
    expect(evidence[0]?.rawState).toBe("finalized");
  });

  it("carries a status with no hash, because the record still exists", () => {
    const evidence = settlementEvidence(inputs({ nodeHash: null, nodeStatus: "pending_submission" }));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.transactionHash).toBeNull();
  });

  it("carries nothing when the node has no record at all", () => {
    expect(settlementEvidence(inputs({ nodeHash: null, nodeStatus: null }))).toEqual([]);
  });
});

describe("settlement states", () => {
  /** The node's own six, preserved verbatim. */
  it("keeps the node's vocabulary", () => {
    expect(settlementState("finalized")).toBe("finalized");
    expect(settlementState("submitted_unconfirmed")).toBe("submitted_unconfirmed");
    expect(settlementState("abandoned")).toBe("abandoned");
  });

  /** An unrecognised status is preserved as `unknown` rather than mapped onto
   * the nearest known one, which would assert protocol knowledge this build
   * does not have. */
  it("preserves an unrecognised status as unknown rather than guessing", () => {
    expect(settlementState("submitted_and_then_some")).toBe("unknown");
    expect(settlementState(null)).toBe("unknown");
  });
});

describe("relationships", () => {
  it("names a block settlement by the block, and carries the settling transaction", () => {
    const association = blockSettlement(identity, HEADER, inputs());
    expect(association.kind).toBe("block_settlement");
    if (association.kind !== "block_settlement") return;
    expect(association.l2BlockHeaderHash).toBe(HEADER);
    expect(association.l1TxHash).toBe(NODE_HASH);
    expect(association.state).toBe("finalized");
    expect(association.reconciliation).toBe("node_reported");
  });

  /** Many L2 transactions share one settlement transaction, and nothing about
   * that changes the L1 identity each of them reports. */
  it("gives every transaction in one block the same settlement hash", () => {
    const first = transactionSettlement(identity, "1".repeat(64), HEADER, inputs());
    const second = transactionSettlement(identity, "2".repeat(64), HEADER, inputs());
    expect(first.kind === "l2_transaction_settlement" && first.l1TxHash).toBe(NODE_HASH);
    expect(second.kind === "l2_transaction_settlement" && second.l1TxHash).toBe(NODE_HASH);
  });

  /** A transaction with no inclusion has no settlement to report, and saying
   * "none" is different from saying nothing could be established. */
  it("reports none for a transaction that is in no block", () => {
    const association = transactionSettlement(identity, "1".repeat(64), null, inputs({
      nodeHash: null,
      nodeStatus: null,
    }));
    expect(association.reconciliation).toBe("none");
    expect(association.kind === "l2_transaction_settlement" && association.l1TxHash).toBeNull();
    expect(association.kind === "l2_transaction_settlement" && association.state).toBe("unknown");
  });

  /** "In no block" comes from the node's ledger alone, so a copy of it cannot
   * support the claim: the live node may have included this transaction after
   * the copy was taken. */
  it("does not report none for an unincluded transaction read from a copy", () => {
    const association = transactionSettlement(identity, "1".repeat(64), null, inputs({
      nodeHash: null,
      nodeStatus: null,
      nodeFreshness: "fixed",
    }));
    expect(association.reconciliation).toBe("unavailable");
  });

  /** Bridge records are provenance from one source, and always were. The index
   * was never consulted for them, so this is the one area the decommission did
   * not change. */
  it("reports bridge relationships as the node's record", () => {
    const deposit = depositOrigin(identity, NODE_HASH, "d".repeat(64), null);
    const withdrawal = withdrawalRequest(identity, NODE_HASH, 2, "outref", null);
    const forced = forcedTransactionOrder(identity, NODE_HASH, 0, "t".repeat(64), null);
    for (const association of [deposit, withdrawal, forced]) {
      expect(association.reconciliation).toBe("node_reported");
      expect(association.evidence.map((row) => row.source)).toEqual(["midgard_bridge_record"]);
    }
    expect(deposit.kind).toBe("deposit_origin");
    expect(withdrawal.kind).toBe("withdrawal_request");
    expect(forced.kind).toBe("forced_transaction_order");
  });

  /** One timestamp, for the one source. A Cardano "as of" beside it would
   * describe an observation nothing here makes. */
  it("carries the Midgard as-of and no Cardano as-of", () => {
    const association = blockSettlement(identity, HEADER, inputs());
    expect(association.l2ObservedAsOf).toBe("2026-09-02T00:00:00Z");
    expect(association).not.toHaveProperty("l1ObservedAsOf");
  });
});
