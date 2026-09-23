"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
// Imported with the canvas rather than in the root layout, so the graph
// stylesheet can travel with the chunk that needs it.
import "@xyflow/react/dist/style.css";
import type { TransactionView } from "@midgard-explorer/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  elkFlowGraph,
  fallbackFlowPositions,
  flowGraph,
  FLOW_NODE_WIDTH,
  type FlowGraph,
  type FlowPosition,
  type ElkFlowGraph,
  needsElkLayout,
} from "../../../../lib/flow";
import { Amount, FlowCard } from "./cards";
import { Chip } from "../../base/layout";
import { InspectionContext } from "./inspection";
import { canvasEdges, canvasNodes, type CanvasNode } from "./layout";

const NODE_TYPES: NodeTypes = { utxo: FlowCard };

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

    const fallBackToDeterministic = () =>
      setLayout({ graph, positions: fallback, state: "fallback" });
    let cancelled = false;
    const worker = new Worker(
      new URL("../../../../workers/elk-layout.worker.ts", import.meta.url),
      {
        name: "midgard-elk-layout",
        type: "module",
      },
    );
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
        Lines route through the transaction: the ledger does not record which input funded which
        output.
      </p>
    </div>
  );
}
