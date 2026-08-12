"use client";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
// Imported with the canvas rather than in the root layout, so the graph
// stylesheet can travel with the chunk that needs it.
import "@xyflow/react/dist/style.css";
import type { TransactionView } from "@midgard-explorer/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  elkFlowGraph,
  fallbackFlowPositions,
  flowGraph,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  type FlowGraph,
  type FlowGraphNode,
  type FlowPosition,
  type ElkFlowGraph,
  needsElkLayout,
} from "../../lib/flow";
import { formatAda } from "../../lib/format";
import { flowEdgeVisual, maxEdgeLovelace } from "../../lib/flowEdge";
import { Icon } from "./icons";

type CanvasData = {
  graphNode: FlowGraphNode;
  onRevealAll: () => void;
};
type CanvasNode = Node<CanvasData, "utxo">;

type InspectionState = {
  inspectedNodeId: string | null;
  inspectNode: (id: string) => void;
};

const InspectionContext = createContext<InspectionState | null>(null);

const short = (value: string, head = 8, tail = 6) =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

function Amount({ lovelace }: { lovelace: bigint }) {
  return (
    <span className="font-mono tabular-nums">
      <span aria-hidden className="text-text-3">
        ₳
      </span>{" "}
      {formatAda(lovelace)}
      <span className="sr-only"> ada</span>
    </span>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded border border-border bg-surface px-1.5 py-px text-[11px] text-text-3">
      {children}
    </span>
  );
}

function NodeLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      className="nodrag nopan block min-w-0 truncate font-mono text-xs text-link hover:text-link-hover hover:underline"
      href={href}
    >
      {children}
    </a>
  );
}

function TransactionCard({ node }: { node: Extract<FlowGraphNode, { kind: "transaction" }> }) {
  return (
    <div data-testid="flow-node-transaction" className="h-full p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-text">
        <Icon name="transfer" size={15} />
        <span className="mg-overline text-text">Transaction</span>
      </div>
      <NodeLink href={`/transaction/${node.txId}`}>{short(node.txId, 10, 8)}</NodeLink>
      <p className="mt-2 mg-caption text-text-2">
        {node.inputCount} input{node.inputCount === 1 ? "" : "s"} · {node.outputCount} output
        {node.outputCount === 1 ? "" : "s"}
      </p>
      <p className="mg-caption text-text-2">
        Fee <Amount lovelace={node.fee} />
      </p>
    </div>
  );
}

function ClusterCard({
  node,
  onRevealAll,
}: {
  node: Extract<FlowGraphNode, { kind: "cluster" }>;
  onRevealAll: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`flow-cluster-${node.side}`}
      className="nodrag nopan h-full w-full border-0 p-3 text-left"
      onClick={onRevealAll}
      aria-label={`Reveal ${node.hidden} more ${node.side}s`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="mg-overline">More {node.side}s</span>
        <Icon name="layers" size={15} />
      </div>
      <p className="mt-2 text-sm font-semibold text-text">
        {node.hidden} grouped UTxO{node.hidden === 1 ? "" : "s"}
      </p>
      <p className="mt-1 mg-caption text-text-2">
        Combined <Amount lovelace={node.hiddenLovelace} />
      </p>
      <p className="mt-2 inline-flex items-center gap-1 mg-caption font-medium text-link">
        Reveal all <Icon name="arrowRight" size={13} />
      </p>
    </button>
  );
}

function UtxoCard({
  node,
  inspected,
  onInspect,
}: {
  node: Extract<FlowGraphNode, { kind: "input" | "output" }>;
  inspected: boolean;
  onInspect: (id: string) => void;
}) {
  const item = node.item;
  const script = item.addressKind === "Script";
  return (
    <div data-testid={`flow-node-${item.kind}`} className="h-full p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon name={item.kind === "input" ? "arrowDownToLine" : "arrowUpFromLine"} size={15} />
          <span className="mg-overline">
            {item.kind} {item.kind === "output" ? item.label : ""}
          </span>
        </div>
        <button
          type="button"
          className="nodrag nopan rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text"
          aria-expanded={inspected}
          aria-label={`${inspected ? "Hide" : "Show"} ${item.kind} ${item.label} details`}
          onClick={() => onInspect(node.id)}
        >
          <Icon name={inspected ? "chevronDown" : "chevronRight"} size={14} />
        </button>
      </div>

      {item.kind === "input" ? (
        <div className="mt-1.5">
          <NodeLink href={item.href ?? "#"}>{short(item.label)}</NodeLink>
        </div>
      ) : null}

      {item.address === null ? (
        <p className="mt-1.5 mg-caption text-text-3">
          Spend side not resolvable (spent or pruned).
        </p>
      ) : (
        <div className="mt-1.5">
          <NodeLink href={item.href ?? `/address/${item.address}`}>{short(item.address)}</NodeLink>
        </div>
      )}

      {item.resolved ? (
        <p className="mt-1.5 text-sm text-text">
          <Amount lovelace={item.lovelace} />
        </p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap gap-1">
        {item.addressKind !== null ? <Chip>{script ? "Script" : "Key"}</Chip> : null}
        {item.assetCount > 0 ? (
          <Chip>{`${item.assetCount} asset${item.assetCount === 1 ? "" : "s"}`}</Chip>
        ) : null}
        {item.hasDatum ? <Chip>datum</Chip> : null}
        {item.hasScriptRef ? <Chip>script ref</Chip> : null}
      </div>
    </div>
  );
}

function FlowCard({ data }: NodeProps<CanvasNode>) {
  const node = data.graphNode;
  const inspection = useContext(InspectionContext);
  const inspected = inspection?.inspectedNodeId === node.id;
  return (
    <div
      className={`mg-flow-node h-full w-full border bg-surface shadow-sm ${
        node.kind === "transaction"
          ? "rounded-md border-border-strong"
          : node.kind === "cluster"
            ? "rounded-md border-dashed border-border-strong bg-surface-2"
            : node.item.addressKind === "Script"
              ? "rounded-sm border-l-2 border-l-accent border-border"
              : "rounded-md border-border"
      }`}
    >
      {node.kind !== "input" ? (
        <Handle type="target" position={Position.Left} isConnectable={false} />
      ) : null}
      {node.kind === "transaction" ? <TransactionCard node={node} /> : null}
      {node.kind === "cluster" ? <ClusterCard node={node} onRevealAll={data.onRevealAll} /> : null}
      {node.kind === "input" || node.kind === "output" ? (
        <UtxoCard
          node={node}
          inspected={inspected}
          onInspect={inspection?.inspectNode ?? (() => undefined)}
        />
      ) : null}
      {node.kind !== "output" ? (
        <Handle type="source" position={Position.Right} isConnectable={false} />
      ) : null}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { utxo: FlowCard };

const positionMap = (positions: FlowPosition[]) => new Map(positions.map((p) => [p.id, p]));

function canvasNodes(
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

const canvasEdges = (graph: FlowGraph): Edge[] => {
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

export function UtxoFlowCanvas({
  tx,
  onSettled,
}: {
  tx: TransactionView;
  /** Reports that the canvas has mounted and finished placing its nodes, so
   * the surrounding view can publish a readiness state instead of leaving a
   * reader, or a test, to infer it from how long they have waited. */
  onSettled?: (outcome: "ready" | "error") => void;
}) {
  const graph = useMemo(() => flowGraph(tx, true), [tx]);
  const fallback = useMemo(() => fallbackFlowPositions(graph), [graph]);
  const needsElk = useMemo(() => needsElkLayout(graph), [graph]);

  /* The layout result carries the graph it was computed for.
   *
   * That tag is what lets the arranging state and the fallback positions be
   * derived during render rather than reset from an effect. Resetting from an
   * effect meant a new transaction rendered once against the previous
   * transaction's coordinates before the reset landed, and it is the pattern
   * the compiler flags as a cascading render. Every write below now happens in
   * a worker callback, never in the effect body.
   *
   * `Worker` is read during render safely because the canvas is loaded with
   * `ssr: false`: this component never renders anywhere but a browser. */
  const [layout, setLayout] = useState<{
    graph: FlowGraph;
    positions: FlowPosition[];
    state: "ready" | "fallback";
  } | null>(null);

  const settled = layout !== null && layout.graph === graph ? layout : null;
  const positions = settled?.positions ?? fallback;
  const layoutState: "arranging" | "ready" | "deterministic" | "fallback" =
    settled !== null
      ? settled.state
      : !needsElk
        ? "deterministic"
        : typeof Worker === "undefined"
          ? "fallback"
          : "arranging";

  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null);
  const [instance, setInstance] = useState<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const inspectNode = useCallback((id: string) => {
    setInspectedNodeId((current) => (current === id ? null : id));
  }, []);

  const revealAll = useCallback(() => undefined, []);

  const frameGraph = useCallback(
    (duration: number) => {
      if (instance === null) return;
      if (graph.nodes.length > 100) {
        const transaction = positions.find((position) => position.id.startsWith("transaction-"));
        if (transaction !== undefined) {
          const narrow = (canvasRef.current?.clientWidth ?? window.innerWidth) < 640;
          const transactionCenter = transaction.x + FLOW_NODE_WIDTH / 2;
          void instance.setCenter(
            narrow ? transactionCenter + 210 : transactionCenter,
            transaction.y + 56,
            {
              zoom: narrow ? 0.6 : 0.88,
              duration,
            },
          );
          return;
        }
      }
      void instance.fitView({ padding: 0.15, duration, maxZoom: 1 });
    },
    [graph.nodes.length, instance, positions],
  );

  useEffect(() => {
    // Both of these are already reflected by the derived `layoutState`, so
    // there is nothing for the effect to announce: it only runs the engine.
    if (!needsElk || typeof Worker === "undefined") return;

    const fallBackToDeterministic = () => setLayout({ graph, positions: fallback, state: "fallback" });
    let cancelled = false;
    const worker = new Worker(new URL("../../workers/elk-layout.worker.ts", import.meta.url), {
      name: "midgard-elk-layout",
      type: "module",
    });
    const timeout = window.setTimeout(() => {
      cancelled = true;
      worker.terminate();
      fallBackToDeterministic();
    }, 10_000);

    worker.onmessage = (
      event: MessageEvent<{ id: number; data?: ElkFlowGraph; error?: unknown }>,
    ) => {
      if (cancelled || event.data.id !== 1) return;
      window.clearTimeout(timeout);
      if (event.data.error !== undefined || event.data.data === undefined) {
        fallBackToDeterministic();
      } else {
        const next = (event.data.data.children ?? []).map((node) => ({
          id: node.id,
          x: node.x ?? 0,
          y: node.y ?? 0,
        }));
        if (next.length === graph.nodes.length) {
          setLayout({ graph, positions: next, state: "ready" });
        } else {
          fallBackToDeterministic();
        }
      }
      worker.terminate();
    };
    worker.onerror = () => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      fallBackToDeterministic();
      worker.terminate();
    };
    worker.postMessage({
      id: 1,
      graph: elkFlowGraph(graph),
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      worker.terminate();
    };
  }, [fallback, graph, needsElk]);

  useEffect(() => {
    if (layoutState === "arranging" || instance === null) return;
    frameGraph(graph.nodes.length > 100 ? 0 : 250);
  }, [frameGraph, graph.nodes.length, instance, layoutState, positions]);

  /* One report per outcome. `fallback` is a settled outcome too: the graph is
   * placed and usable, it simply was not placed by the layout engine. Only a
   * canvas still arranging is unsettled. */
  useEffect(() => {
    if (layoutState === "arranging" || instance === null) return;
    onSettled?.("ready");
  }, [instance, layoutState, onSettled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || instance === null) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined || entry.contentRect.width === 0 || entry.contentRect.height === 0) {
        return;
      }
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frameGraph(0);
      });
    });
    observer.observe(canvas);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [frameGraph, instance]);

  const nodes = useMemo(
    () => canvasNodes(graph, positions, revealAll),
    [graph, positions, revealAll],
  );
  const edges = useMemo(() => canvasEdges(graph), [graph]);
  const inspectedNode = graph.nodes.find((node) => node.id === inspectedNodeId) ?? null;
  const inspection = useMemo(
    () => ({ inspectedNodeId, inspectNode }),
    [inspectNode, inspectedNodeId],
  );

  return (
    <div role="region" aria-label="Large UTxO canvas" data-layout-state={layoutState}>
      <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <p className="mg-caption text-text-3" aria-live="polite">
          {layoutState === "arranging"
            ? "Arranging transaction flow…"
            : layoutState === "fallback"
              ? "Showing deterministic fallback layout."
              : layoutState === "deterministic"
                ? `${graph.nodes.length} nodes in deterministic transaction columns.`
                : `${graph.nodes.length} nodes arranged by ELK.`}
        </p>
      </div>

      <div
        ref={canvasRef}
        className="mg-flow-canvas h-[560px] overflow-hidden rounded-md border border-border bg-surface-2/30 sm:h-[640px]"
      >
        <InspectionContext.Provider value={inspection}>
          <ReactFlow<CanvasNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onInit={setInstance}
            minZoom={0.04}
            maxZoom={1.8}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable
            nodesFocusable
            onlyRenderVisibleElements={graph.nodes.length > 100}
            panOnDrag
            zoomOnPinch
            zoomOnScroll={false}
            preventScrolling={false}
            aria-label="Interactive transaction UTxO graph"
          >
            <Background gap={22} size={1} />
            <MiniMap
              className="mg-flow-minimap hidden sm:block"
              pannable
              zoomable
              aria-label="Transaction flow minimap"
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </InspectionContext.Provider>
      </div>

      {inspectedNode?.kind === "input" || inspectedNode?.kind === "output" ? (
        <div
          role="region"
          aria-label={`${inspectedNode.kind} ${inspectedNode.item.label} details`}
          className="mt-3 rounded-md border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mg-overline">{inspectedNode.kind} details</p>
              <p className="mt-1 break-all font-mono text-sm text-text">
                {inspectedNode.item.label}
              </p>
              {inspectedNode.item.address === null ? null : (
                <p className="mt-2 break-all font-mono text-sm text-text-2">
                  {inspectedNode.item.address}
                </p>
              )}
            </div>
            {inspectedNode.item.resolved ? <Amount lovelace={inspectedNode.item.lovelace} /> : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {inspectedNode.item.addressKind ? <Chip>{inspectedNode.item.addressKind}</Chip> : null}
            {inspectedNode.item.assetCount > 0 ? (
              <Chip>{`${inspectedNode.item.assetCount} assets`}</Chip>
            ) : null}
            {inspectedNode.item.hasDatum ? <Chip>datum</Chip> : null}
            {inspectedNode.item.hasScriptRef ? <Chip>script ref</Chip> : null}
          </div>
        </div>
      ) : null}

      <svg data-testid="flow-connectors" aria-hidden="true" className="sr-only" />
      <p className="mt-3 mg-caption text-text-3">
        Every input is consumed by this transaction and every output is produced by it. No line runs
        from an input to an output: the ledger does not record which input funded which output, so
        drawing one would be inventing it. The Table view is the complete non-visual representation.
      </p>
    </div>
  );
}
