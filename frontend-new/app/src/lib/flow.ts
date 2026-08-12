import type { TransactionView } from "@midgard-explorer/contracts";
import type { FlowEdgeFacts } from "./flowEdge";

/**
 * The model behind the UTxO flow view.
 *
 * Two things this deliberately does not do.
 *
 * It draws no edge from an input to an output. A UTxO transaction does not
 * record which input funded which output, so such an edge would be invented.
 * What the ledger does record is that every input is consumed by *the
 * transaction* and every output is produced by it, which is why the shape here
 * is two sides and a fee, with no `edges` field for a component to reach for.
 *
 * It does not assume a transaction fits on the page. Fan-out was measured on
 * 2026-08-07 across every transaction in the node's Postgres (inputs p50/p95/max
 * 1; outputs p50 2, p95 4, max 4). That corpus is small, so a side wider than
 * the initial disclosure budget degrades to the largest by value plus a stated
 * remainder. The interactive view can reveal the complete graph, while the
 * table remains the non-visual complete representation.
 */

/** Nodes rendered per side before the remainder is summarised. Chosen to match
 * the threshold the layout decision was made against, so a transaction that
 * would have justified a graph library is exactly the one that collapses. */
export const FLOW_NODE_BUDGET = 12;

export type FlowNode = {
  kind: "input" | "output";
  /** Position in the transaction's own list. Part of a UTxO's identity, so it
   * survives both the budget and the reordering the budget performs. */
  index: number;
  label: string;
  /** Null only for an input whose spend side did not resolve. */
  address: string | null;
  addressKind: string | null;
  /** Zero for an unresolved input, which is why `resolved` is separate: a
   * missing amount and an amount of zero are different claims. */
  lovelace: bigint;
  assetCount: number;
  href: string | null;
  hasDatum: boolean;
  hasScriptRef: boolean;
  resolved: boolean;
};

export type FlowSide = {
  nodes: FlowNode[];
  hidden: number;
  /** Value of the hidden nodes, so the visible ones are not read as the whole. */
  hiddenLovelace: bigint;
  /** True when this side's total is a lower bound. Only inputs can be
   * incomplete: an output is always part of the transaction being viewed. */
  incomplete: boolean;
};

export type FlowModel = {
  inputs: FlowSide;
  outputs: FlowSide;
  fee: bigint;
};

export type FlowGraphNode =
  | { id: string; kind: "input" | "output"; item: FlowNode }
  | {
      id: string;
      kind: "transaction";
      txId: string;
      fee: bigint;
      inputCount: number;
      outputCount: number;
    }
  | {
      id: string;
      kind: "cluster";
      side: "input" | "output";
      hidden: number;
      hiddenLovelace: bigint;
      incomplete: boolean;
    };

export type FlowGraphEdge = {
  id: string;
  source: string;
  target: string;
  facts: FlowEdgeFacts;
};

export type FlowGraph = {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  clustered: boolean;
  totalNodeCount: number;
};

export type FlowPosition = { id: string; x: number; y: number };

export type ElkFlowGraph = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkFlowGraph[];
  edges?: Array<{ id: string; sources: string[]; targets: string[] }>;
};

export const FLOW_NODE_WIDTH = 272;
export const FLOW_NODE_HEIGHT = 142;

const countAssets = (assets: TransactionView["outputs"][number]["value"]["assets"]): number =>
  Object.values(assets).reduce((n, names) => n + Object.keys(names).length, 0);

/** Apply the budget: keep the largest by value, then restore ledger order so a
 * node's position still means what it says. */
function toSide(nodes: FlowNode[], incomplete: boolean, budget: number): FlowSide {
  if (nodes.length <= budget) {
    return { nodes, hidden: 0, hiddenLovelace: 0n, incomplete };
  }
  const byValue = [...nodes].sort((a, b) =>
    a.lovelace === b.lovelace ? a.index - b.index : a.lovelace > b.lovelace ? -1 : 1,
  );
  const kept = byValue.slice(0, budget).sort((a, b) => a.index - b.index);
  const dropped = byValue.slice(budget);
  return {
    nodes: kept,
    hidden: dropped.length,
    hiddenLovelace: dropped.reduce((sum, n) => sum + n.lovelace, 0n),
    incomplete,
  };
}

export function flowModel(tx: TransactionView, budget: number = FLOW_NODE_BUDGET): FlowModel {
  const inputNodes: FlowNode[] = tx.inputs.map((input, i) => ({
    kind: "input",
    index: i,
    label: `${input.txId}#${input.index}`,
    address: input.resolved?.address ?? null,
    addressKind: input.resolved?.addressKind ?? null,
    lovelace: input.resolved ? BigInt(input.resolved.value.lovelace) : 0n,
    assetCount: input.resolved ? countAssets(input.resolved.value.assets) : 0,
    // An input always links to the transaction that produced it, whether or not
    // the spend side still resolves.
    href: `/transaction/${input.txId}`,
    hasDatum: false,
    hasScriptRef: false,
    resolved: input.resolved !== null,
  }));

  const outputNodes: FlowNode[] = tx.outputs.map((output, i) => ({
    kind: "output",
    index: i,
    label: `#${i}`,
    address: output.address,
    addressKind: output.addressKind,
    lovelace: BigInt(output.value.lovelace),
    assetCount: countAssets(output.value.assets),
    href: `/address/${output.address}`,
    hasDatum: output.hasDatum,
    hasScriptRef: output.hasScriptRef,
    resolved: true,
  }));

  return {
    inputs: toSide(
      inputNodes,
      inputNodes.some((n) => !n.resolved),
      budget,
    ),
    outputs: toSide(outputNodes, false, budget),
    fee: BigInt(tx.fee),
  };
}

/** Build the graph without inferring value provenance. Cluster nodes summarize
 * undisclosed UTxOs and connect only to the transaction, exactly as their
 * individual members would. */
export function flowGraph(
  tx: TransactionView,
  expanded = false,
  budget: number = FLOW_NODE_BUDGET,
): FlowGraph {
  const model = flowModel(tx, expanded ? Number.MAX_SAFE_INTEGER : budget);
  const transactionId = `transaction-${tx.txId}`;
  const nodes: FlowGraphNode[] = [
    ...model.inputs.nodes.map((item): FlowGraphNode => ({
      id: `input-${item.index}`,
      kind: "input",
      item,
    })),
    {
      id: transactionId,
      kind: "transaction",
      txId: tx.txId,
      fee: model.fee,
      inputCount: tx.inputs.length,
      outputCount: tx.outputs.length,
    },
    ...model.outputs.nodes.map((item): FlowGraphNode => ({
      id: `output-${item.index}`,
      kind: "output",
      item,
    })),
  ];

  if (model.inputs.hidden > 0) {
    nodes.push({
      id: "cluster-input",
      kind: "cluster",
      side: "input",
      hidden: model.inputs.hidden,
      hiddenLovelace: model.inputs.hiddenLovelace,
      incomplete: model.inputs.incomplete,
    });
  }
  if (model.outputs.hidden > 0) {
    nodes.push({
      id: "cluster-output",
      kind: "cluster",
      side: "output",
      hidden: model.outputs.hidden,
      hiddenLovelace: model.outputs.hiddenLovelace,
      incomplete: false,
    });
  }

  const edges: FlowGraphEdge[] = [];
  for (const node of nodes) {
    if (node.kind === "input" || (node.kind === "cluster" && node.side === "input")) {
      edges.push({
        id: `${node.id}-to-${transactionId}`,
        source: node.id,
        target: transactionId,
        facts:
          node.kind === "cluster"
            ? {
                lovelace: node.hiddenLovelace,
                resolved: !node.incomplete,
                addressKind: null,
              }
            : {
                lovelace: node.item.lovelace,
                resolved: node.item.resolved,
                addressKind: node.item.addressKind,
              },
      });
    }
    if (node.kind === "output" || (node.kind === "cluster" && node.side === "output")) {
      edges.push({
        id: `${transactionId}-to-${node.id}`,
        source: transactionId,
        target: node.id,
        facts:
          node.kind === "cluster"
            ? { lovelace: node.hiddenLovelace, resolved: true, addressKind: null }
            : {
                lovelace: node.item.lovelace,
                resolved: true,
                addressKind: node.item.addressKind,
              },
      });
    }
  }

  return {
    nodes,
    edges,
    clustered: model.inputs.hidden > 0 || model.outputs.hidden > 0,
    totalNodeCount: tx.inputs.length + tx.outputs.length + 1,
  };
}

/** Immediate, deterministic positions keep the graph usable if workers are
 * unavailable and avoid a blank frame while ELK computes its layered layout. */
export function fallbackFlowPositions(graph: FlowGraph): FlowPosition[] {
  const columns = {
    input: graph.nodes.filter(
      (node) => node.kind === "input" || (node.kind === "cluster" && node.side === "input"),
    ),
    transaction: graph.nodes.filter((node) => node.kind === "transaction"),
    output: graph.nodes.filter(
      (node) => node.kind === "output" || (node.kind === "cluster" && node.side === "output"),
    ),
  };
  const maxRows = Math.max(columns.input.length, columns.output.length, 1);
  const step = FLOW_NODE_HEIGHT + 28;
  const centredY = (count: number, index: number) => ((maxRows - count) * step) / 2 + index * step;

  return [
    ...columns.input.map((node, index) => ({
      id: node.id,
      x: 0,
      y: centredY(columns.input.length, index),
    })),
    ...columns.transaction.map((node) => ({
      id: node.id,
      x: 420,
      y: ((maxRows - 1) * step) / 2,
    })),
    ...columns.output.map((node, index) => ({
      id: node.id,
      x: 840,
      y: centredY(columns.output.length, index),
    })),
  ];
}

/** ELK only adds information when the graph has more than one transaction
 * layer or an edge bypasses the single transaction hub. A one-transaction
 * UTxO star cannot contain an edge crossing at any vertical ordering, even at
 * hundreds of nodes, so the deterministic columns are the complete layout. */
export function needsElkLayout(graph: FlowGraph): boolean {
  const transactions = new Set(
    graph.nodes.filter((node) => node.kind === "transaction").map((node) => node.id),
  );
  if (transactions.size > 1) return true;
  const [hub] = transactions;
  return graph.edges.some((edge) => edge.source !== hub && edge.target !== hub);
}

/** ELK receives only geometry and topology. Transaction contents never cross
 * the worker boundary, reducing both cloning cost and the worker's data access. */
export function elkFlowGraph(graph: FlowGraph): ElkFlowGraph {
  return {
    id: "utxo-flow",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      // React Flow draws the visible edges; asking ELK to route 500 edge paths
      // adds seconds of discarded work. ELK remains responsible for positions.
      "elk.edgeRouting": "STRAIGHT",
      "elk.layered.layering.strategy": "LONGEST_PATH",
      "elk.layered.nodePlacement.strategy": "SIMPLE",
      "elk.layered.highDegreeNodes.treatment": "true",
      "elk.layered.highDegreeNodes.threshold": "16",
      "elk.layered.thoroughness": "3",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.spacing.nodeNode": "28",
      "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    },
    children: graph.nodes.map((node): ElkFlowGraph => {
      const layerConstraint =
        node.kind === "input" || (node.kind === "cluster" && node.side === "input")
          ? "FIRST"
          : node.kind === "output" || (node.kind === "cluster" && node.side === "output")
            ? "LAST"
            : null;
      return {
        id: node.id,
        width: FLOW_NODE_WIDTH,
        height: node.kind === "transaction" ? 112 : FLOW_NODE_HEIGHT,
        ...(layerConstraint === null
          ? {}
          : { layoutOptions: { "elk.layered.layering.layerConstraint": layerConstraint } }),
      };
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}
