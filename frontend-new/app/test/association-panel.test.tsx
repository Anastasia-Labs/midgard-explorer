import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Association, DeploymentContext } from "@midgard-explorer/contracts";
import { CardanoAssociation } from "../src/components/ui/domain/association";

/**
 * The two rules this panel exists to keep.
 *
 * Both hashes survive a disagreement, because the disagreement IS the finding
 * and rendering one of them would hide it. And an index that is behind is
 * described as behind rather than as a denial: the block page printed "the
 * explorer-owned Cardano index has not attributed its Cardano commitment
 * transaction" for blocks the index had attributed perfectly, so a defect read
 * as index lag for as long as it existed.
 */

const NODE_HASH = "a".repeat(64);
const INDEX_HASH = "b".repeat(64);
const HEADER = "c".repeat(56);

const context: DeploymentContext = {
  deploymentId: "dep",
  network: "preprod",
  networkMagic: null,
  database: "midgard",
  sourceKind: "primary",
  identityState: "verified",
  freshness: { state: "live", observedAsOf: "2026-09-02T00:00:00Z", lagSeconds: 3 },
} as unknown as DeploymentContext;

/* The brands (`Hash32`, `Hash28`) exist so a route cannot be handed the wrong
 * kind of identifier. A fixture builder is the one place a plain string is
 * legitimately becoming one, so the cast is here and nowhere in src. */
const association = (over: Record<string, unknown> = {}): Association =>
  ({
    kind: "block_settlement",
    deploymentId: "dep",
    network: "preprod",
    reconciliation: "matched",
    l2ObservedAsOf: "2026-09-02T00:00:00Z",
    l1ObservedAsOf: "2026-09-02T00:00:01Z",
    evidence: [
      {
        source: "midgard_finalization_journal",
        transactionHash: NODE_HASH,
        outputIndex: null,
        blockHeight: null,
        observedAt: null,
        rawState: "finalized",
      },
    ],
    l2BlockHeaderHash: HEADER,
    l1TxHash: NODE_HASH,
    state: "finalized",
    ...over,
  }) as unknown as Association;

describe("a matched association", () => {
  it("says two independent sources agree", () => {
    render(<CardanoAssociation association={association()} context={context} />);
    expect(screen.getByText(/two independent sources/i)).toBeTruthy();
  });

  it("names the relationship rather than leaving it to be inferred", () => {
    render(<CardanoAssociation association={association()} context={context} />);
    expect(screen.getByText("Block settlement")).toBeTruthy();
  });
});

describe("a disagreement", () => {
  const contested = association({
    reconciliation: "mismatch",
    l1TxHash: null,
    evidence: [
      {
        source: "midgard_finalization_journal",
        transactionHash: NODE_HASH,
        outputIndex: null,
        blockHeight: null,
        observedAt: null,
        rawState: "finalized",
      },
      {
        source: "cardano_l1_index",
        transactionHash: INDEX_HASH,
        outputIndex: null,
        blockHeight: 5_000_000,
        observedAt: null,
        rawState: null,
      },
    ],
  });

  /** Neither is dropped. A response that kept one would hide the finding, and a
   * reader handed a single hash would never know a second existed. */
  it("shows both hashes", () => {
    const { container } = render(<CardanoAssociation association={contested} context={context} />);
    const text = container.textContent ?? "";
    expect(text).toContain(NODE_HASH.slice(0, 10));
    expect(text).toContain(INDEX_HASH.slice(0, 10));
  });

  it("names both sources so a reader knows which said what", () => {
    render(<CardanoAssociation association={contested} context={context} />);
    expect(screen.getByText("Midgard node")).toBeTruthy();
    expect(screen.getByText("Explorer's Cardano index")).toBeTruthy();
  });

  it("says plainly that they disagree", () => {
    render(<CardanoAssociation association={contested} context={context} />);
    expect(screen.getByText(/two sources disagree/i)).toBeTruthy();
  });
});

describe("an index that is behind", () => {
  /** The inversion this replaces: reporting lag as absence, or a defect as lag. */
  /** Whatever the index's state, a one-sided result never reads as proof that
   * settlement did not happen. That is the claim the panel must not make. */
  it("never turns a missing index record into evidence of no settlement", () => {
    render(
      <CardanoAssociation
        association={association({ reconciliation: "node_only" })}
        context={context}
      />,
    );
    expect(screen.getByText(/not evidence|has not observed it/i)).toBeTruthy();
  });

  it("calls stale too far behind to compare, rather than a disagreement", () => {
    render(
      <CardanoAssociation
        association={association({ reconciliation: "stale" })}
        context={context}
      />,
    );
    expect(screen.getByText(/too far behind to compare/i)).toBeTruthy();
  });

  it("says an unreadable index says nothing about settlement", () => {
    render(
      <CardanoAssociation
        association={association({ reconciliation: "unavailable" })}
        context={context}
      />,
    );
    expect(screen.getByText(/says nothing about whether settlement happened/i)).toBeTruthy();
  });
});

describe("nothing to show", () => {
  it("renders nothing at all when there is no association", () => {
    const { container } = render(<CardanoAssociation association={null} context={context} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders without a context, which is the degraded case", () => {
    const { container } = render(<CardanoAssociation association={association()} context={null} />);
    expect(container.textContent).toContain("Block settlement");
  });
});

describe("provenance says something different from settlement", () => {
  /**
   * A deposit's L1 hash is where the funds came from, and the node is the only
   * source that has one: the Cardano index is never asked for a second opinion
   * on it. The generic `node_only` copy told a reader the index "has not
   * covered this transaction yet", describing a comparison that was never
   * attempted, which is the same false absence the block page used to print.
   */
  it("does not tell a deposit it is waiting for index coverage", () => {
    render(
      <CardanoAssociation
        association={
          {
            kind: "deposit_origin",
            reconciliation: "node_only",
            deploymentId: "dep",
            network: "preprod",
            l2ObservedAsOf: null,
            l1ObservedAsOf: null,
            evidence: [],
            l1TxHash: "a".repeat(64),
            l1OutputIndex: 0,
            l2TxId: null,
          } as never
        }
        context={null}
      />,
    );
    expect(screen.queryByText(/index lag/i)).toBeNull();
    expect(screen.queryByText(/has not covered/i)).toBeNull();
    expect(screen.getByText(/No second source is compared/i)).toBeTruthy();
  });

  /** A block genuinely is waiting for the index, so it keeps the lag wording. */
  it("still tells a block settlement that the index is behind", () => {
    render(
      <CardanoAssociation
        association={
          {
            kind: "block_settlement",
            reconciliation: "node_only",
            deploymentId: "dep",
            network: "preprod",
            l2ObservedAsOf: null,
            l1ObservedAsOf: null,
            evidence: [],
            l2BlockHeaderHash: "c".repeat(56),
            l1TxHash: "a".repeat(64),
            state: "finalized",
          } as never
        }
        context={null}
      />,
    );
    expect(screen.getByText(/holds no record of this transaction/i)).toBeTruthy();
  });

  /**
   * A replica reports a state and no duration, and the panel has to say the
   * state anyway.
   *
   * `lagSeconds` is null for every standby now: receive-versus-replay measures
   * a standby against itself, and true lag needs a comparison against the
   * primary that this connection cannot make. The panel used to print the
   * freshness state only alongside a duration, so removing the number would
   * have silently removed the word "lagging" from the interface.
   */
  it("names a replica's freshness even with no duration to attach", () => {
    render(
      <CardanoAssociation
        association={association()}
        context={
          {
            ...context,
            sourceKind: "replica",
            freshness: { state: "lagging", observedAsOf: "2026-09-02T00:00:00Z", lagSeconds: null },
          } as unknown as DeploymentContext
        }
      />,
    );
    expect(screen.getByText(/replica on preprod, lagging/i)).toBeTruthy();
  });

  it("still attaches a duration when one was measured", () => {
    render(<CardanoAssociation association={association()} context={context} />);
    expect(screen.getByText(/primary on preprod, live by/i)).toBeTruthy();
  });

  /**
   * "That is index lag" was asserted for every one-sided result, including one
   * from an index reporting itself live. Lag is the usual cause and not an
   * available one there, and explaining away the single case that deserves a
   * look is worse than saying less.
   */
  it("does not blame lag when the index reports itself current", () => {
    render(
      <CardanoAssociation
        association={association({ reconciliation: "node_only" })}
        context={context}
      />,
    );
    expect(screen.queryByText(/index lag/i)).toBeNull();
    expect(screen.getByText(/absent from a current index/i)).toBeTruthy();
  });

  /**
   * The backend decides this, not the panel.
   *
   * A version of this component tested `context.freshness` to choose the
   * wording, which is the L2 SOURCE's freshness: a live node made the panel
   * announce the Cardano index as current whatever the index was doing.
   * `reconcile` now returns `stale` when the index cannot be compared, so an
   * index that is behind never reaches the `node_only` copy at all.
   */
  it("says the sources were not comparable when the resolver says stale", () => {
    render(
      <CardanoAssociation
        association={association({ reconciliation: "stale" })}
        context={context}
      />,
    );
    expect(screen.queryByText(/is current and holds no record/i)).toBeNull();
  });

  /**
   * Four situations, four sentences. `stale` used to say "the index is too far
   * behind" about all of them, which is true of one: an index that never
   * completed a pass is not behind, an unverified identity is not behind, and a
   * snapshot is fixed rather than lagging.
   */
  it.each([
    ["index_lagging", /too far behind/i],
    ["index_freshness_unknown", /has not completed a pass/i],
    ["identity_unverified", /not known to describe one deployment/i],
    ["l2_source_not_current", /copy rather than the live node/i],
  ])("explains %s in its own terms", (reason, expected) => {
    render(
      <CardanoAssociation
        association={association({ reconciliation: "stale", comparability: reason })}
        context={context}
      />,
    );
    expect(screen.getByText(expected)).toBeTruthy();
  });

  /**
   * One reason, three sources, and only one of them is a snapshot.
   *
   * `l2_source_not_current` is reached by a snapshot, by a standby that is
   * behind, and by a standby whose currency could not be established. The
   * message said "Midgard data is a fixed copy... from a snapshot", which is
   * false of the two replica states, and a replica reaches this reason far more
   * often than a snapshot does. The callout now says only what holds for all
   * three; the source row is where the specific one is named.
   */
  it("does not call a lagging replica a snapshot", () => {
    render(
      <CardanoAssociation
        association={association({
          reconciliation: "stale",
          comparability: "l2_source_not_current",
        })}
        context={
          {
            ...context,
            sourceKind: "replica",
            freshness: { state: "lagging", observedAsOf: "2026-09-02T00:00:00Z", lagSeconds: null },
          } as unknown as DeploymentContext
        }
      />,
    );
    expect(screen.queryByText(/fixed copy|come from a snapshot/i)).toBeNull();
    expect(screen.getByText(/copy rather than the live node/i)).toBeTruthy();
    expect(screen.getByText(/replica on preprod, lagging/i)).toBeTruthy();
  });

  /** A backend that predates the field still gets a sentence, and it is the one
   * that was there before. */
  it("falls back to the lag wording when no reason is carried", () => {
    render(
      <CardanoAssociation
        association={association({ reconciliation: "stale" })}
        context={context}
      />,
    );
    expect(screen.getByText(/too far behind/i)).toBeTruthy();
  });
});
