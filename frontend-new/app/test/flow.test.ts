import { describe, expect, it } from "vitest";
import {
  FLOW_NODE_BUDGET,
  elkFlowGraph,
  fallbackFlowPositions,
  flowGraph,
  flowModel,
  needsElkLayout,
} from "../src/lib/flow";
import type { TransactionView } from "@midgard-explorer/contracts";
import { flowEdgeVisual } from "../src/lib/flowEdge";

/**
 * Phase 3: the model behind the UTxO flow.
 *
 * Measured 2026-08-07 against every transaction in the node's Postgres: inputs
 * p50/p95/max 1, outputs p50 2, p95 4, max 4. Nothing came close to the budget,
 * so the initial graph is deliberately bounded. The corpus is small though, so
 * the model still has to say what it does when a transaction is wider than the
 * page can hold, and these tests pin both progressive disclosure and the
 * complete graph path.
 */

const value = (lovelace: string, assets: Record<string, Record<string, string>> = {}) =>
  ({ lovelace, assets }) as TransactionView["outputs"][number]["value"];

const output = (lovelace: string, address = "addr_test_out") =>
  ({
    address,
    addressKind: "PubKey",
    value: value(lovelace),
    hasDatum: false,
    hasScriptRef: false,
    datum: null,
    scriptRef: null,
  }) as TransactionView["outputs"][number];

const input = (lovelace: string | null, index = 0) =>
  ({
    txId: "aa".repeat(32),
    index,
    resolved:
      lovelace === null
        ? null
        : { address: "addr_test_in", addressKind: "PubKey", value: value(lovelace) },
  }) as TransactionView["inputs"][number];

const tx = (over: Partial<TransactionView>): TransactionView =>
  ({
    txId: "bb".repeat(32),
    fee: "170000",
    inputs: [],
    outputs: [],
    ...over,
  }) as TransactionView;

describe("flow model", () => {
  it("puts every input and output on its own side", () => {
    const model = flowModel(tx({ inputs: [input("5000000")], outputs: [output("4830000")] }));
    expect(model.inputs.nodes).toHaveLength(1);
    expect(model.outputs.nodes).toHaveLength(1);
    expect(model.fee).toBe(170000n);
  });

  it("keeps the output index, because it is part of the UTxO's identity", () => {
    const model = flowModel(tx({ outputs: [output("1"), output("2"), output("3")] }));
    expect(model.outputs.nodes.map((n) => n.index)).toEqual([0, 1, 2]);
  });

  it("carries the outref of an input so the node can link to where it came from", () => {
    const model = flowModel(tx({ inputs: [input("5000000", 3)] }));
    expect(model.inputs.nodes[0]?.href).toBe(`/transaction/${"aa".repeat(32)}`);
    expect(model.inputs.nodes[0]?.label).toBe(`${"aa".repeat(32)}#3`);
  });

  it("marks an unresolved input rather than drawing it as worth nothing", () => {
    const model = flowModel(tx({ inputs: [input(null)] }));
    expect(model.inputs.nodes[0]?.resolved).toBe(false);
    expect(model.inputs.nodes[0]?.address).toBe(null);
    expect(model.inputs.incomplete).toBe(true);
  });

  it("does not call the input side incomplete when every input resolved", () => {
    const model = flowModel(tx({ inputs: [input("1"), input("2", 1)] }));
    expect(model.inputs.incomplete).toBe(false);
  });

  it("never reports the output side as incomplete: outputs are always in the transaction", () => {
    const model = flowModel(tx({ outputs: [output("1")] }));
    expect(model.outputs.incomplete).toBe(false);
  });
});

describe("a transaction wider than the budget", () => {
  const many = Array.from({ length: FLOW_NODE_BUDGET + 5 }, (_, i) =>
    output(String((i + 1) * 1000)),
  );

  it("renders the budget and reports the rest as hidden", () => {
    const model = flowModel(tx({ outputs: many }));
    expect(model.outputs.nodes).toHaveLength(FLOW_NODE_BUDGET);
    expect(model.outputs.hidden).toBe(5);
  });

  it("keeps the largest by value, since those are the ones worth seeing", () => {
    const model = flowModel(tx({ outputs: many }));
    const kept = model.outputs.nodes.map((n) => n.index);
    // The five smallest (indices 0-4) are the ones dropped.
    expect(kept).not.toContain(0);
    expect(kept).toContain(many.length - 1);
  });

  it("still shows the kept nodes in ledger order, not in value order", () => {
    const model = flowModel(tx({ outputs: many }));
    const kept = model.outputs.nodes.map((n) => n.index);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
  });

  it("states the value of what it hid, so the visible total is not mistaken for the whole", () => {
    const model = flowModel(tx({ outputs: many }));
    // Indices 0-4 hold 1000 through 5000.
    expect(model.outputs.hiddenLovelace).toBe(15000n);
  });

  it("hides nothing when the transaction fits", () => {
    const model = flowModel(tx({ outputs: [output("1")] }));
    expect(model.outputs.hidden).toBe(0);
    expect(model.outputs.hiddenLovelace).toBe(0n);
  });
});

describe("what the model refuses to say", () => {
  it("exposes no edge between an input and an output", () => {
    const model = flowModel(
      tx({ inputs: [input("5000000")], outputs: [output("1"), output("2")] }),
    );
    // A UTxO transaction does not record which input funded which output, so
    // there is nothing on this model that could be drawn as that edge. Every
    // input meets the transaction; the transaction produces every output.
    expect(model).not.toHaveProperty("edges");
    expect(Object.keys(model).sort()).toEqual(["fee", "inputs", "outputs"]);
  });
});

describe("what a node carries for the reader", () => {
  it("counts native assets so a node can say the value is more than ada", () => {
    const withAssets = {
      ...output("1000000"),
      value: value("1000000", { [`${"ab".repeat(28)}`]: { "4d4944": "5", "424242": "7" } }),
    } as TransactionView["outputs"][number];
    const model = flowModel(tx({ outputs: [withAssets] }));
    expect(model.outputs.nodes[0]?.assetCount).toBe(2);
  });

  it("carries the datum and script-ref flags the output already declares", () => {
    const scripted = {
      ...output("1000000"),
      addressKind: "Script",
      hasDatum: true,
      hasScriptRef: true,
    } as TransactionView["outputs"][number];
    const model = flowModel(tx({ outputs: [scripted] }));
    expect(model.outputs.nodes[0]).toMatchObject({
      addressKind: "Script",
      hasDatum: true,
      hasScriptRef: true,
    });
  });
});

describe("interactive graph construction", () => {
  it("uses the transaction as the only bridge between inputs and outputs", () => {
    const transaction = tx({
      inputs: [input("5000000")],
      outputs: [output("2000000"), output("2830000")],
    });
    const graph = flowGraph(transaction);
    const transactionNode = graph.nodes.find((node) => node.kind === "transaction");
    expect(transactionNode).toBeDefined();
    expect(graph.edges).toHaveLength(3);
    expect(
      graph.edges.every(
        (edge) => edge.source === transactionNode?.id || edge.target === transactionNode?.id,
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) => edge.source.startsWith("input-") && edge.target.startsWith("output-"),
      ),
    ).toBe(false);
  });

  it("represents undisclosed outputs as one truthful cluster", () => {
    const outputs = Array.from({ length: 100 }, (_, i) => output(String(i + 1)));
    const graph = flowGraph(tx({ outputs }));
    const cluster = graph.nodes.find((node) => node.kind === "cluster" && node.side === "output");
    expect(graph.clustered).toBe(true);
    expect(graph.nodes).toHaveLength(FLOW_NODE_BUDGET + 2);
    expect(cluster).toMatchObject({ kind: "cluster", hidden: 88 });
    expect(graph.totalNodeCount).toBe(101);
  });

  it("reveals every node and edge only after explicit expansion", () => {
    const outputs = Array.from({ length: 500 }, (_, i) => output(String(i + 1)));
    const graph = flowGraph(tx({ outputs }), true);
    expect(graph.clustered).toBe(false);
    expect(graph.nodes).toHaveLength(501);
    expect(graph.edges).toHaveLength(500);
  });

  it("provides complete deterministic fallback positions", () => {
    const graph = flowGraph(tx({ inputs: [input("5")], outputs: [output("2"), output("3")] }));
    const first = fallbackFlowPositions(graph);
    expect(first).toEqual(fallbackFlowPositions(graph));
    expect(new Set(first.map((position) => position.id))).toEqual(
      new Set(graph.nodes.map((node) => node.id)),
    );
    expect(first.find((position) => position.id.startsWith("input-"))?.x).toBeLessThan(
      first.find((position) => position.id.startsWith("transaction-"))?.x ?? 0,
    );
  });

  it("sends only topology and dimensions to the ELK worker", () => {
    const graph = flowGraph(tx({ inputs: [input("5")], outputs: [output("5")] }));
    const elk = elkFlowGraph(graph);
    expect(elk.layoutOptions).toMatchObject({
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
    });
    expect(elk.children).toHaveLength(3);
    expect(elk.edges).toHaveLength(2);
    expect(JSON.stringify(elk)).not.toContain("addr_test");
    expect(JSON.stringify(elk)).not.toContain("lovelace");
  });

  it("does not run ELK for a single-transaction star, regardless of node count", () => {
    const transaction = tx({
      outputs: Array.from({ length: 500 }, (_, i) => output(String(i + 1))),
    });
    expect(needsElkLayout(flowGraph(transaction, true))).toBe(false);
  });

  it("runs ELK when topology contains an edge that bypasses the transaction hub", () => {
    const graph = flowGraph(
      tx({ inputs: [input("5")], outputs: [output("2"), output("3")] }),
      true,
    );
    const inputNode = graph.nodes.find((node) => node.kind === "input");
    const outputNode = graph.nodes.find((node) => node.kind === "output");
    expect(inputNode).toBeDefined();
    expect(outputNode).toBeDefined();
    expect(
      needsElkLayout({
        ...graph,
        edges: [
          ...graph.edges,
          {
            id: "future-cross-layer-edge",
            source: inputNode!.id,
            target: outputNode!.id,
            facts: { lovelace: 2n, resolved: true, addressKind: "PubKey" },
          },
        ],
      }),
    ).toBe(true);
  });

  it.each([100, 500])(
    "constructs and positions %i outputs within the unit-test budget",
    (count) => {
      const transaction = tx({
        outputs: Array.from({ length: count }, (_, i) => output(String(i + 1))),
      });
      const started = performance.now();
      const graph = flowGraph(transaction, true);
      const positions = fallbackFlowPositions(graph);
      const elapsed = performance.now() - started;
      expect(graph.nodes).toHaveLength(count + 1);
      expect(positions).toHaveLength(count + 1);
      expect(elapsed).toBeLessThan(100);
    },
  );
});

describe("truthful edge encodings", () => {
  it("uses relative value for width without allowing smaller values to disappear", () => {
    const small = flowEdgeVisual(
      { lovelace: 1n, resolved: true, addressKind: "PubKey" },
      1_000_000n,
    );
    const large = flowEdgeVisual(
      { lovelace: 1_000_000n, resolved: true, addressKind: "PubKey" },
      1_000_000n,
    );
    expect(small.strokeWidth).toBeGreaterThanOrEqual(1.25);
    expect(large.strokeWidth).toBeGreaterThan(small.strokeWidth);
  });

  it("marks unresolved values with both a warning colour and a dash", () => {
    expect(flowEdgeVisual({ lovelace: 0n, resolved: false, addressKind: null }, 1n)).toMatchObject({
      stroke: "var(--mg-warning)",
      strokeDasharray: "6 5",
    });
  });

  it("distinguishes script and key credentials without relying on width", () => {
    const script = flowEdgeVisual({ lovelace: 5n, resolved: true, addressKind: "Script" }, 5n);
    const key = flowEdgeVisual({ lovelace: 5n, resolved: true, addressKind: "PubKey" }, 5n);
    expect(script.stroke).toBe("var(--mg-graph-script)");
    expect(key.stroke).toBe("var(--mg-graph-key)");
    expect(script.strokeWidth).toBe(key.strokeWidth);
  });

  /** `--mg-accent` and `--mg-success` hold the same value in both themes, so a
   * script edge drawn in the accent was drawn in the success colour, beside a
   * "Valid" badge that means something else entirely. Graph encodings get their
   * own tokens so a hue means one thing per viewport. */
  it("keeps graph encodings out of the status palette", () => {
    const strokes = [
      flowEdgeVisual({ lovelace: 5n, resolved: true, addressKind: "Script" }, 5n).stroke,
      flowEdgeVisual({ lovelace: 5n, resolved: true, addressKind: "PubKey" }, 5n).stroke,
    ];
    for (const stroke of strokes) {
      expect(stroke).not.toBe("var(--mg-success)");
      expect(stroke).not.toBe("var(--mg-accent)");
      expect(stroke).not.toBe("var(--mg-danger)");
    }
  });
});
