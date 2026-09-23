// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Association, DeploymentContext } from "@midgard-explorer/contracts";
import { CardanoAssociation, hasRecordedSettlement } from "../src/components/ui/domain/association";

/**
 * The rule this panel exists to keep: nothing it says is presented as
 * confirmed.
 *
 * The explorer reads one source, the Midgard node. It used to also keep a
 * Cardano index and arbitrate between the two, and most of this file tested
 * that arbitration. The index is decommissioned; what is left to prove is that
 * every wording names the node, that an empty record never reads as evidence,
 * and that a state this build does not know cannot take the page down.
 */

const NODE_HASH = "a".repeat(64);
const HEADER = "c".repeat(56);

const context: DeploymentContext = {
  deploymentId: "dep",
  network: "preprod",
  networkMagic: null,
  database: "midgard",
  sourceKind: "primary",
  identityState: "configured",
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
    reconciliation: "node_reported",
    l2ObservedAsOf: "2026-09-02T00:00:00Z",
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

describe("a settlement the node reported", () => {
  it("attributes the transaction to the node", () => {
    render(<CardanoAssociation association={association()} context={context} />);
    expect(screen.getByText("Settlement transaction reported by the node")).toBeTruthy();
    expect(screen.getByText(/does not check Cardano itself/)).toBeTruthy();
    expect(screen.getByText("Midgard node")).toBeTruthy();
  });

  it("claims no confirmation, agreement or second source", () => {
    const { container } = render(
      <CardanoAssociation association={association()} context={context} />,
    );
    const text = (container.textContent ?? "").toLowerCase();
    for (const claim of ["agree", "index", "confirmed", "corroborat", "verified"]) {
      expect(text, `the panel said "${claim}"`).not.toContain(claim);
    }
  });

  it("keeps the settlement link and the node's raw state", () => {
    const { container } = render(
      <CardanoAssociation association={association()} context={context} />,
    );
    expect(container.querySelector(`a[href="/l1/transaction/${NODE_HASH}"]`)).toBeTruthy();
    expect(container.textContent).toContain("finalized");
  });

  it("shows one timestamp, for the one source", () => {
    render(<CardanoAssociation association={association()} context={context} />);
    expect(screen.getByText("Midgard data as of")).toBeTruthy();
    expect(screen.queryByText("Cardano data as of")).toBeNull();
  });

  /** Configured is not verified, and the source row says which. */
  it("names the deployment as configured", () => {
    render(<CardanoAssociation association={association()} context={context} />);
    expect(screen.getByText(/deployment as configured/)).toBeTruthy();
  });
});

describe("a record with no settlement transaction", () => {
  it("says none was recorded, without inventing evidence", () => {
    const { container } = render(
      <CardanoAssociation
        association={association({ reconciliation: "none", l1TxHash: null, evidence: [] })}
        context={context}
      />,
    );
    expect(screen.getByText("No settlement transaction recorded")).toBeTruthy();
    expect(container.textContent).not.toMatch(/reported by the node/);
    expect(container.querySelector('a[href^="/l1/transaction/"]')).toBeNull();
  });

  it("does not present a copy's silence as a settled absence", () => {
    render(
      <CardanoAssociation
        association={association({ reconciliation: "unavailable", l1TxHash: null, evidence: [] })}
        context={context}
      />,
    );
    expect(screen.getByText("Settlement could not be established")).toBeTruthy();
    expect(screen.getByText(/says nothing about whether settlement happened/)).toBeTruthy();
  });
});

describe("provenance", () => {
  /** A deposit's hash is where the funds came from, not a settlement, and the
   * wording keeps that distinction while carrying the same verdict. */
  it("does not call a deposit's origin a settlement transaction", () => {
    render(
      <CardanoAssociation
        association={association({
          kind: "deposit_origin",
          l1OutputIndex: null,
          l2TxId: null,
          evidence: [
            {
              source: "midgard_bridge_record",
              transactionHash: NODE_HASH,
              outputIndex: null,
              blockHeight: null,
              observedAt: null,
              rawState: null,
            },
          ],
        })}
        context={context}
      />,
    );
    expect(screen.getByText("Recorded by the node")).toBeTruthy();
    expect(screen.queryByText("Settlement transaction reported by the node")).toBeNull();
    expect(screen.getByText("Midgard bridge record")).toBeTruthy();
  });
});

describe("placement", () => {
  it("counts only a reported settlement as settled", () => {
    expect(hasRecordedSettlement(association())).toBe(true);
    expect(hasRecordedSettlement(association({ reconciliation: "none" }))).toBe(false);
    expect(hasRecordedSettlement(association({ reconciliation: "unavailable" }))).toBe(false);
    expect(hasRecordedSettlement(null)).toBe(false);
  });
});

/**
 * A backend newer than this bundle.
 *
 * Nothing in this repository deploys the API and the interface together, so a
 * restart between them serves states this bundle has never heard of. The
 * verdict table was indexed blind, so an unknown state read `undefined.tone`
 * and threw inside a server component, taking the whole page down.
 */
describe("a state this build does not recognise", () => {
  it("says so instead of crashing the page", () => {
    const { container } = render(
      <CardanoAssociation
        association={association({ reconciliation: "something_new_entirely" })}
        context={context}
      />,
    );
    expect(screen.getByText(/does not recognise the state/i)).toBeTruthy();
    expect((container.textContent ?? "").includes("Midgard node")).toBe(true);
  });
});
