import { describe, expect, it } from "vitest";
import {
  blockSettlement,
  comparability,
  depositOrigin,
  reconcile,
  resolvedHash,
  settlementEvidence,
  settlementState,
  transactionSettlement,
  withdrawalRequest,
  COMPARABLE_WITHIN_SECONDS,
  type SettlementInputs,
} from "../src/db/association.js";

/**
 * The reconciliation rules, as arithmetic over two observations and a clock.
 *
 * No database here on purpose. These decisions are the product's central claim,
 * and needing a running node to prove them is how they would go untested: the
 * whole reason the original defect survived is that every gate read one source.
 */

const NODE_HASH = "a".repeat(64);
const INDEX_HASH = "b".repeat(64);
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
  indexHash: NODE_HASH,
  // Verified by default so each case states its own departure from it. A
  // mismatch requires it, because two sources reading two DEPLOYMENTS are
  // supposed to name different transactions and that is a configuration
  // mistake rather than an integrity failure.
  identityVerified: true,
  indexObservedAt: "2026-09-02T00:00:01Z",
  indexBlockHeight: 5_000_000,
  indexAvailable: true,
  indexLagSeconds: 0,
  // A live L2 source by default, so a case that cares about reading a snapshot
  // or a standby says so.
  nodeFreshness: "live",
  ...over,
});

describe("reconcile", () => {
  it("matches when both sources name the same transaction", () => {
    expect(reconcile(inputs())).toBe("matched");
  });

  it("is node_only when the index holds no header", () => {
    expect(reconcile(inputs({ indexHash: null }))).toBe("node_only");
  });

  it("is index_only when the node recorded no attempt", () => {
    expect(reconcile(inputs({ nodeHash: null }))).toBe("index_only");
  });

  /**
   * A one-sided answer is a claim about the silent side, and an index that has
   * not completed a pass cannot support one.
   *
   * `node_only` used to be returned the moment the index had no row, and the
   * interface explained every one of them as index lag. An index with no
   * coverage has no lag to blame: the honest answer is that the two were not
   * comparable, which is what `stale` says.
   */
  it("is stale, not node_only, when the index cannot be compared", () => {
    expect(reconcile(inputs({ indexHash: null, indexLagSeconds: null }))).toBe("stale");
  });

  it("is stale, not node_only, when the index is too far behind", () => {
    expect(reconcile(inputs({ indexHash: null, indexLagSeconds: 60 * 60 * 24 }))).toBe("stale");
  });

  /** Identity matters as much as freshness: a current index belonging to another
   * deployment says nothing about this one. */
  it("is stale, not node_only, when the index identity is unverified", () => {
    expect(reconcile(inputs({ indexHash: null, identityVerified: false }))).toBe("stale");
  });

  it("is stale, not index_only, when the index cannot be compared", () => {
    expect(reconcile(inputs({ nodeHash: null, indexLagSeconds: null }))).toBe("stale");
  });

  /**
   * A node silence read from a SNAPSHOT is a fact about the copy.
   *
   * `index_only` says the node recorded no attempt. From a point-in-time copy
   * that is not something this process knows: the live node may hold a
   * finalization the snapshot predates. The index's own freshness cannot answer
   * it, which is why the L2 source's state is an input here.
   */
  /** A standby says nothing about its distance from the primary, so its
   * freshness is `lagging` or `unknown` far more often than a snapshot's is
   * `fixed`. All three are the same claim: the node's silence is a fact about
   * the copy being read. */
  it.each(["fixed", "lagging", "unknown"] as const)(
    "is stale, not index_only, when the L2 source is %s",
    (nodeFreshness) => {
      expect(reconcile(inputs({ nodeHash: null, nodeFreshness }))).toBe("stale");
    },
  );

  /** A node ABSENCE is the only claim a stale L2 source cannot support. When the
   * node did answer, its currency does not change what the index failing to see
   * the block means. */
  it("still reports node_only from a snapshot, because the node did answer", () => {
    expect(reconcile(inputs({ indexHash: null, nodeFreshness: "fixed" }))).toBe("node_only");
  });

  it("names why two sources were not comparable", () => {
    expect(comparability(inputs())).toBe("comparable");
    expect(comparability(inputs({ identityVerified: false }))).toBe("identity_unverified");
    expect(comparability(inputs({ indexLagSeconds: null }))).toBe("index_freshness_unknown");
    expect(comparability(inputs({ indexLagSeconds: 60 * 60 * 24 }))).toBe("index_lagging");
    expect(comparability(inputs({ nodeFreshness: "fixed" }))).toBe("l2_source_not_current");
    expect(comparability(inputs({ nodeFreshness: "lagging" }))).toBe("l2_source_not_current");
    expect(comparability(inputs({ nodeFreshness: "unknown" }))).toBe("l2_source_not_current");
  });

  /** A node that recorded no attempt has no status either. Inheriting
   * "finalized" from the default made this fixture describe a node that
   * finalized something without naming it, which is not a state the resolver
   * can be asked about. */
  const neither = (over: Partial<SettlementInputs> = {}) =>
    inputs({ nodeHash: null, nodeStatus: null, indexHash: null, ...over });

  it("is none when neither source has anything", () => {
    expect(reconcile(neither())).toBe("none");
  });

  /**
   * Two silences are not evidence of absence.
   *
   * `none` reads as "nothing has been submitted for this record", which is a
   * positive claim about both sources at once. An index that has never
   * completed a pass, beside a snapshot taken before the block settled, holds
   * nothing and proves nothing. This case returned `none` before any freshness
   * rule was reached, so an unbuilt index plus an old copy read to a user as
   * "no Cardano settlement yet".
   */
  it.each([
    ["the index never completed a pass", { indexLagSeconds: null }],
    ["the index is far behind", { indexLagSeconds: 60 * 60 * 24 }],
    ["the deployment identity is unverified", { identityVerified: false }],
    ["the L2 source is a copy", { nodeFreshness: "fixed" as const }],
  ])("is stale, not none, when both are silent and %s", (_case, over) => {
    expect(reconcile(neither(over))).toBe("stale");
  });

  /** An unreadable source cannot disagree with anything. Reporting a mismatch
   * here would blame the data for an outage. */
  it("is unavailable when the index could not be read and the node has nothing", () => {
    expect(reconcile(inputs({ indexAvailable: false, nodeHash: null }))).toBe("unavailable");
  });

  /** An unreadable index is silence, whatever the node says. This asserted
   * `node_only`, which claims the index WAS read and held nothing. It was not
   * read at all, and the difference matters to a reader deciding whether
   * settlement is missing or merely unobserved. The node's evidence is still
   * carried either way. */
  it("reports unavailable when the index is unreadable, even with a node hash", () => {
    expect(reconcile(inputs({ indexAvailable: false }))).toBe("unavailable");
  });

  it("is a mismatch when both are fresh and they differ", () => {
    expect(reconcile(inputs({ indexHash: INDEX_HASH }))).toBe("mismatch");
  });

  /**
   * The rule that stops replication lag becoming a false integrity alarm. An
   * index that has not caught up has not disagreed about anything, and a
   * mismatch reported every quiet hour teaches a reader to ignore the real one.
   */
  it("is stale rather than a mismatch when the index is behind", () => {
    const behind = inputs({
      indexHash: INDEX_HASH,
      indexLagSeconds: COMPARABLE_WITHIN_SECONDS + 1,
    });
    expect(reconcile(behind)).toBe("stale");
  });

  it("still reports a mismatch at the edge of the comparable window", () => {
    const atEdge = inputs({
      indexHash: INDEX_HASH,
      indexLagSeconds: COMPARABLE_WITHIN_SECONDS,
    });
    expect(reconcile(atEdge)).toBe("mismatch");
  });

  /** Unknown lag is not permission to assume freshness, but it is not proof of
   * staleness either. The sources genuinely differ, so it is reported. */
  /**
   * Unknown freshness is not fresh.
   *
   * This asserted `mismatch`, and `getIndexSettlement` returned a null or zero
   * lag in every real case, so `stale` was unreachable and every lagging
   * disagreement was promoted to a false integrity alarm. That is the exact
   * failure the state was introduced to prevent, encoded as the expected
   * behaviour by this test.
   */
  it("reports stale, not mismatch, when freshness could not be established", () => {
    expect(reconcile(inputs({ indexHash: INDEX_HASH, indexLagSeconds: null }))).toBe("stale");
  });

  /** No disagreement hands back a single actionable hash, however it arose. A
   * caller given one would never know a second existed. */
  it("resolves no hash for either kind of disagreement", () => {
    const fresh = inputs({ indexHash: INDEX_HASH });
    const unknown = inputs({ indexHash: INDEX_HASH, indexLagSeconds: null });
    expect(resolvedHash(reconcile(fresh), fresh)).toBeNull();
    expect(resolvedHash(reconcile(unknown), unknown)).toBeNull();
  });
});

describe("evidence", () => {
  /** Both observations survive a disagreement. A response that kept one would
   * hide the finding. */
  it("keeps both hashes on a mismatch", () => {
    const evidence = settlementEvidence(inputs({ indexHash: INDEX_HASH }));
    expect(evidence.map((e) => e.transactionHash).sort()).toEqual([NODE_HASH, INDEX_HASH].sort());
    expect(evidence.map((e) => e.source).sort()).toEqual([
      "cardano_l1_index",
      "midgard_finalization_journal",
    ]);
  });

  it("records the node's own word for its state, unmapped", () => {
    const evidence = settlementEvidence(inputs({ nodeStatus: "some_future_status" }));
    expect(evidence[0].rawState).toBe("some_future_status");
  });
});

describe("resolvedHash", () => {
  /** Two sources naming different transactions is not a question the API gets
   * to settle by preferring one. */
  it("is null on a mismatch, so no caller acts on a contested hash", () => {
    const contested = inputs({ indexHash: INDEX_HASH });
    expect(resolvedHash("mismatch", contested)).toBeNull();
  });

  it("prefers the index's observation when they agree", () => {
    expect(resolvedHash("matched", inputs())).toBe(NODE_HASH);
  });

  it("falls back to the node's claim when the index has nothing", () => {
    expect(resolvedHash("node_only", inputs({ indexHash: null }))).toBe(NODE_HASH);
  });
});

describe("settlementState", () => {
  it("passes the node's six through unchanged", () => {
    expect(settlementState("observed_waiting_stability")).toBe("observed_waiting_stability");
    expect(settlementState("abandoned")).toBe("abandoned");
  });

  /** Mapping an unrecognised status onto the nearest known one asserts protocol
   * knowledge this build does not have. */
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
  });

  /** Many L2 transactions share one settlement transaction, and nothing about
   * that changes the L1 identity each of them reports. */
  it("gives every transaction in one block the same settlement hash", () => {
    const first = transactionSettlement(identity, "1".repeat(64), HEADER, inputs());
    const second = transactionSettlement(identity, "2".repeat(64), HEADER, inputs());
    expect(first.kind === "l2_transaction_settlement" && first.l1TxHash).toBe(NODE_HASH);
    expect(second.kind === "l2_transaction_settlement" && second.l1TxHash).toBe(NODE_HASH);
    expect(first.kind === "l2_transaction_settlement" && first.l2TxId).not.toBe(
      second.kind === "l2_transaction_settlement" && second.l2TxId,
    );
  });

  /** A transaction with no inclusion has no settlement to report, and saying
   * "none" is different from saying the sources disagree. */
  it("reports none for a transaction that is in no block", () => {
    const association = transactionSettlement(identity, "1".repeat(64), null, inputs());
    expect(association.reconciliation).toBe("none");
    expect(association.comparability).toBe("comparable");
    expect(association.kind === "l2_transaction_settlement" && association.l1TxHash).toBeNull();
  });

  /** "In no block" comes from the node's ledger alone, so a copy cannot support
   * it either: the live node may have included this transaction after the
   * snapshot was taken. The index has no part in the answer, which is why the
   * reason names the L2 source and not the index's unknown freshness. */
  it("reports stale, not none, for an unincluded transaction read from a copy", () => {
    const association = transactionSettlement(identity, "1".repeat(64), null, {
      ...inputs({ nodeFreshness: "fixed" }),
      indexLagSeconds: null,
    });
    expect(association.reconciliation).toBe("stale");
    expect(association.comparability).toBe("l2_source_not_current");
  });

  /** Bridge records are provenance from one source. Calling them `matched`
   * would claim a corroboration nobody sought. */
  it("reports bridge relationships as node_only, not matched", () => {
    const deposit = depositOrigin(identity, NODE_HASH, "d".repeat(64), null);
    const withdrawal = withdrawalRequest(identity, NODE_HASH, 2, "outref", null);
    expect(deposit.reconciliation).toBe("node_only");
    expect(withdrawal.reconciliation).toBe("node_only");
    expect(deposit.kind).toBe("deposit_origin");
    expect(withdrawal.kind).toBe("withdrawal_request");
  });

  /** Both timestamps, because the two databases can never share a snapshot. */
  it("carries an as-of for each side", () => {
    const association = blockSettlement(identity, HEADER, inputs());
    expect(association.l2ObservedAsOf).toBe("2026-09-02T00:00:00Z");
    expect(association.l1ObservedAsOf).toBe("2026-09-02T00:00:01Z");
  });
});

describe("identity is part of what makes a difference meaningful", () => {
  /** Two sources describing two deployments are SUPPOSED to name different
   * transactions. Reporting that as a mismatch would raise an integrity alarm
   * about a misconfiguration, which is the false-alarm class this whole state
   * machine exists to avoid. */
  it("reports stale, not mismatch, when the deployment is unverified", () => {
    const unverified = inputs({
      indexHash: INDEX_HASH,
      identityVerified: false,
    });
    expect(reconcile(unverified)).toBe("stale");
    expect(resolvedHash(reconcile(unverified), unverified)).toBeNull();
  });

  it("still reports a mismatch when identity and freshness are both established", () => {
    expect(reconcile(inputs({ indexHash: INDEX_HASH }))).toBe("mismatch");
  });
});
