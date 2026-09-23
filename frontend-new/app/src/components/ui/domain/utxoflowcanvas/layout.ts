import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import {
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  type FlowGraph,
  type FlowGraphNode,
  type FlowPosition,
} from "../../../../lib/flow";
import { flowEdgeVisual, maxEdgeLovelace } from "../../../../lib/flowEdge";

/**
 * Where each node sits, and what joins them.
 *
 * Placement only. Nothing here renders: the same positions are produced by the
 * deterministic fallback and by the layout worker, so keeping the arithmetic
 * apart from the drawing is what lets either be checked on its own.
 */
export type CanvasData = {
  graphNode: FlowGraphNode;
  onRevealAll: () => void;
};

export type CanvasNode = Node<CanvasData, "utxo">;

export const positionMap = (positions: FlowPosition[]) => new Map(positions.map((p) => [p.id, p]));

export function canvasNodes(
  graph: FlowGraph,
  positions: FlowPosition[],
  onRevealAll: () => void,
): CanvasNode[] {
  const byId = positionMap(positions);
  return graph.nodes.map((graphNode) => {
    const height = graphNode.kind === "transaction" ? 112 : FLOW_NODE_HEIGHT;
    return {
      id: graphNode.id,
      type: "utxo",
      position: byId.get(graphNode.id) ?? { x: 0, y: 0 },
      initialWidth: FLOW_NODE_WIDTH,
      initialHeight: height,
      width: FLOW_NODE_WIDTH,
      height,
      style: { width: FLOW_NODE_WIDTH, height },
      data: { graphNode, onRevealAll },
      draggable: false,
      connectable: false,
      selectable: true,
      focusable: true,
      ariaLabel:
        graphNode.kind === "transaction"
          ? `Transaction ${graphNode.txId}`
          : graphNode.kind === "cluster"
            ? `${graphNode.hidden} grouped ${graphNode.side}s. Activate to reveal all.`
            : `${graphNode.kind} ${graphNode.item.label}`,
    };
  });
}

export const canvasEdges = (graph: FlowGraph): Edge[] => {
  const maxLovelace = maxEdgeLovelace(graph.edges.map((edge) => edge.facts));
  return graph.edges.map((edge) => {
    const visual = flowEdgeVisual(edge.facts, maxLovelace);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      focusable: false,
      selectable: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: visual.stroke,
      },
      style: visual,
    };
  });
};
