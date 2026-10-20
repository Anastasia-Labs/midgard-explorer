import { describe, expect, it } from "vitest";
import {
  decodeAssociation,
  decodeDeploymentContext,
  decodeForcedTxsPage,
} from "@midgard-explorer/contracts";
import { statusOf, STATUS_REGISTRY } from "../src/lib/status-registry";
import { journeyProgress } from "../src/lib/journey";
import {
  decodeAssociation as decodeAssociationAt0fe65589,
  decodeDeploymentContext as decodeDeploymentContextAt0fe65589,
} from "./fixtures/consumer-0fe65589/contracts/association";
import { decodeForcedTxsPage as decodeForcedTxsPageAt0fe65589 } from "./fixtures/consumer-0fe65589/contracts/bridge";
import { STATUS_REGISTRY as REGISTRY_AT_0FE65589 } from "./fixtures/consumer-0fe65589/status-registry";

/**
 * Which frontend can read which backend.
 *
 * A deployed bundle decodes every response against its own contracts, and a
 * closed literal it does not know fails the whole response as
 * `malformed_response`. So a backend that starts sending a new code needs the
 * frontend that knows it to be deployed first. These cases pin both halves of
 * that: the new frontend reads old and new responses, and the bundle deployed
 * at 0fe65589 cannot read the new settlement states or the archive source.
 */

const block = (state: string) => ({
  deploymentId: null,
  network: "preprod",
  reconciliation: "node_reported",
  l2ObservedAsOf: null,
  evidence: [],
  kind: "block_settlement",
  l2BlockHeaderHash: "ab".repeat(28),
  l1TxHash: "cd".repeat(32),
  state,
});

/** The deployment context a response carries as `midgard`. */
const context = (sourceKind: string) => ({
  deploymentId: null,
  network: "preprod",
  networkMagic: 1,
  database: "midgard",
  sourceKind,
  identityState: "configured",
  freshness: { state: "live", observedAsOf: null, lagSeconds: null },
});

const forcedPage = (row: Record<string, unknown>) => ({
  rows: [
    {
      tx_order_id: "01".repeat(32),
      tx_order_l1_tx_hash: "02".repeat(32),
      tx_order_l1_output_index: 0,
      tx_id: "03".repeat(32),
      status: "projected",
      inclusion_time: "2026-10-19T00:00:00.000Z",
      projected_header_hash: null,
      ...row,
    },
  ],
  hasNextPage: false,
  total: 1,
  limit: 25,
  page: 1,
});

describe("the new frontend reading responses from the backend at 0fe65589", () => {
  it("labels every status that backend could send exactly as before", () => {
    for (const [code, old] of Object.entries(REGISTRY_AT_0FE65589)) {
      const now = STATUS_REGISTRY[code];
      expect(now, `${code} lost its entry`).toBeDefined();
      expect({ kind: now!.kind, tone: now!.tone, label: now!.label }, code).toEqual({
        kind: old.kind,
        tone: old.tone,
        label: old.label,
      });
    }
  });

  it("decodes a finalized block and a forced row with an old validity code", () => {
    expect(() => decodeAssociation(block("finalized"))).not.toThrow();
    expect(() => decodeForcedTxsPage(forcedPage({ operator_validity: "TxIsValid" }))).not.toThrow();
  });
});

describe("the new frontend reading responses from the f4cf28ca1 backend", () => {
  it("decodes a locally applied block and a forced verdict with its reason", () => {
    for (const state of ["locally_applied", "waiting_to_merge", "merged"])
      expect(decodeAssociation(block(state))).toMatchObject({ state });
    const page = decodeForcedTxsPage(
      forcedPage({ operator_validity: "ForcedTxInvalid", operator_verdict_reason: "EmptyInputs" }),
    );
    expect(page.rows[0]).toMatchObject({ operator_verdict_reason: "EmptyInputs" });
  });

  it("gives every new code a label, and an unseen code a readable fallback", () => {
    for (const code of [
      "locally_applied",
      "waiting_to_merge",
      "merged",
      "ForcedTxValid",
      "ForcedTxInvalid",
      "Unknown",
      "a_code_from_later",
    ]) {
      const resolved = statusOf(code);
      expect(resolved.label, code).toBeTruthy();
      expect(resolved.label, code).not.toBe("undefined");
      expect(() => journeyProgress(code), code).not.toThrow();
    }
    expect(statusOf("locally_applied").known).toBe(true);
    expect(statusOf("a_code_from_later")).toMatchObject({ known: false, tone: "neutral" });
  });
});

describe("the bundle deployed at 0fe65589 reading the f4cf28ca1 backend", () => {
  /** Why the frontend deploys first: this is what an old page would show. */
  it("rejects a block in any new settlement state as a malformed response", () => {
    for (const state of ["locally_applied", "waiting_to_merge", "merged"])
      expect(() => decodeAssociationAt0fe65589(block(state)), state).toThrow();
    expect(() => decodeAssociationAt0fe65589(block("finalized"))).not.toThrow();
  });

  /** Every response that carries `midgard` names its source kind, so an old
   * bundle pointed at a public-source backend cannot read those responses. */
  it("rejects the archive source kind, which the new frontend reads", () => {
    expect(() => decodeDeploymentContextAt0fe65589(context("archive"))).toThrow();
    expect(() => decodeDeploymentContextAt0fe65589(context("replica"))).not.toThrow();
    expect(decodeDeploymentContext(context("archive"))).toMatchObject({ sourceKind: "archive" });
  });

  /** The verdict travels in an open string and the reason in a new field, so
   * an old bundle reads the forced listing whatever the verdict is. */
  it("still reads a forced row with a new verdict and its reason", () => {
    expect(() =>
      decodeForcedTxsPageAt0fe65589(
        forcedPage({
          operator_validity: "ForcedTxInvalid",
          operator_verdict_reason: "EmptyInputs",
        }),
      ),
    ).not.toThrow();
  });
});
