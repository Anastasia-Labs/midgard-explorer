"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { useCallback, useState } from "react";
import type { TransactionView } from "@midgard-explorer/contracts";
import { flowModel, type FlowNode, type FlowSide } from "../../../lib/flow";
import { flowEdgeVisual, maxEdgeLovelace, type FlowEdgeFacts } from "../../../lib/flowEdge";
import { formatAda } from "../../../lib/format";
import { Icon } from "../base/icons";
import { AddressLink } from "./address";
import { Identifier } from "./identifier";
import { Chip } from "../base/layout";

const LARGE_FLOW_THRESHOLD = 40;

const InteractiveFlow = dynamic(
  () => import("./utxoflowcanvas").then((module) => module.UtxoFlowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="h-80 animate-pulse rounded-md border border-border bg-surface-2/40" />
    ),
  },
);

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

function StaticNode({ node }: { node: FlowNode }) {
  const script = node.addressKind === "Script";
  return (
    <article
      data-testid={`flow-node-${node.kind}`}
      // `w-full`: a flex item sizes to its content by default, which left a
      // stacked card using half a phone screen beside the full-width
      // transaction card.
      className={`my-1.5 w-full min-w-0 border bg-surface p-3 shadow-sm ${
        script ? "rounded-sm border-l-2 border-l-accent border-border" : "rounded-md border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 mg-overline">
          <Icon name={node.kind === "input" ? "arrowDownToLine" : "arrowUpFromLine"} size={15} />
          {node.kind} {node.kind === "output" ? node.label : ""}
        </span>
        {node.addressKind === null ? null : <Chip>{script ? "Script" : "Key"}</Chip>}
      </div>

      {node.kind === "input" ? (
        <div className="mt-1 min-w-0">
          <Identifier value={node.label} href={node.href ?? undefined} head={8} tail={6} />
        </div>
      ) : null}

      {node.address === null ? (
        <p className="mt-1.5 mg-caption text-text-3">
          Spend side not resolvable (spent or pruned).
        </p>
      ) : (
        <div className="mt-1.5 min-w-0">
          {/* The same mark the tables use. The diagram is the one view where a
              reader compares two addresses without either being on screen in
              full, which is exactly what the mark is for. `size` is smaller
              than a table row's: a node card is a tighter space and the mark
              is a hint, not a heading. */}
          <AddressLink
            address={node.address}
            href={node.href ?? undefined}
            size={16}
            head={8}
            tail={6}
          />
        </div>
      )}

      {node.resolved ? (
        <p className="mt-1.5 text-sm text-text">
          <Amount lovelace={node.lovelace} />
        </p>
      ) : null}

      {node.assetCount > 0 || node.hasDatum || node.hasScriptRef ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {node.assetCount > 0 ? (
            <Chip>{`${node.assetCount} asset${node.assetCount === 1 ? "" : "s"}`}</Chip>
          ) : null}
          {node.hasDatum ? <Chip>datum</Chip> : null}
          {node.hasScriptRef ? <Chip>script ref</Chip> : null}
        </div>
      ) : null}
    </article>
  );
}

function Remainder({ side, kind }: { side: FlowSide; kind: "input" | "output" }) {
  return (
    <div
      data-testid={`flow-cluster-${kind}`}
      className="my-1.5 rounded-md border border-dashed border-border-strong bg-surface-2/40 p-3"
    >
      <p className="text-sm font-semibold text-text">
        {side.hidden} more UTxO{side.hidden === 1 ? "" : "s"}
      </p>
      <p className="mt-1 mg-caption text-text-2">
        Combined <Amount lovelace={side.hiddenLovelace} />
      </p>
    </div>
  );
}

function Column({ side, kind }: { side: FlowSide; kind: "input" | "output" }) {
  const cells = side.nodes.length + (side.hidden > 0 ? 1 : 0);
  return (
    <div
      // `lg:h-full` is what makes the fr rows measure the same height the
      // connectors do. Without it the grid keeps `height: auto`, so its tracks
      // resolve against content while the SVG beside it spans the stretched row,
      // and the side with fewer nodes top-aligns while its lines stay centred.
      // On a 1-input 2-output transaction that put the input line 67px below the
      // card it leaves from.
      className="grid min-w-0 lg:h-full lg:grid-rows-[repeat(var(--flow-rows),minmax(0,1fr))]"
      style={{ "--flow-rows": Math.max(cells, 1) } as CSSProperties}
    >
      {side.nodes.map((node) => (
        <div key={`${node.kind}-${node.index}`} className="flex min-w-0 items-center">
          <StaticNode node={node} />
        </div>
      ))}
      {side.hidden > 0 ? (
        <div className="flex items-center">
          <Remainder side={side} kind={kind} />
        </div>
      ) : null}
    </div>
  );
}

function sideEdgeFacts(side: FlowSide): FlowEdgeFacts[] {
  return [
    ...side.nodes.map((node) => ({
      lovelace: node.lovelace,
      resolved: node.resolved,
      addressKind: node.addressKind,
    })),
    ...(side.hidden > 0
      ? [
          {
            lovelace: side.hiddenLovelace,
            resolved: !side.incomplete,
            addressKind: null,
          },
        ]
      : []),
  ];
}

function Connectors({
  facts,
  maxLovelace,
  direction,
}: {
  facts: readonly FlowEdgeFacts[];
  maxLovelace: bigint;
  direction: "in" | "out";
}) {
  const rows = Math.max(facts.length, 1);
  return (
    <svg
      data-testid="flow-connectors"
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="hidden h-full w-full text-border-strong lg:block"
    >
      {facts.map((edge, index) => {
        const y = ((index + 0.5) / rows) * 100;
        const [from, to] = direction === "in" ? [y, 50] : [50, y];
        const visual = flowEdgeVisual(edge, maxLovelace);
        return (
          <path
            key={index}
            data-edge-resolved={edge.resolved ? "true" : "false"}
            data-edge-kind={edge.addressKind ?? "unknown"}
            d={`M 0 ${from} C 50 ${from}, 50 ${to}, 100 ${to}`}
            fill="none"
            stroke={visual.stroke}
            strokeWidth={visual.strokeWidth}
            strokeDasharray={visual.strokeDasharray}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${formatAda(edge.lovelace)} ada${edge.resolved ? "" : ", unresolved"}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

function StaticFlow({ tx, large }: { tx: TransactionView; large: boolean }) {
  const model = flowModel(tx, large ? undefined : Number.MAX_SAFE_INTEGER);
  const inputFacts = sideEdgeFacts(model.inputs);
  const outputFacts = sideEdgeFacts(model.outputs);
  const maxLovelace = maxEdgeLovelace([...inputFacts, ...outputFacts]);

  return (
    <div data-layout-state="static">
      {/* Bounded and centred rather than stretched. At 1440px the two columns
          were pinned to opposite edges with a void between them, which reads as
          an unfinished canvas rather than as a diagram. */}
      <div
        data-testid="flow-diagram"
        // The connector columns were 56px, which squeezed a bezier drawn across
        // a square viewBox into a hook. 96px gives the curve room to read as a
        // curve without taking width from the node columns.
        className="mx-auto grid w-full max-w-[62rem] grid-cols-1 items-stretch gap-y-2 lg:grid-cols-[minmax(0,1fr)_96px_176px_96px_minmax(0,1fr)] lg:gap-y-0"
      >
        <div>
          <p className="mb-1 mg-overline text-text-3 lg:hidden">Consumed inputs</p>
          <Column side={model.inputs} kind="input" />
        </div>
        <Connectors facts={inputFacts} maxLovelace={maxLovelace} direction="in" />
        <div
          data-testid="flow-node-transaction"
          className="my-1.5 self-center rounded-md border border-border-strong bg-surface p-3 text-center shadow-sm"
        >
          <div className="flex items-center justify-center gap-1.5">
            <Icon name="transfer" size={15} />
            <span className="mg-overline text-text">Transaction</span>
          </div>
          <div className="mt-1">
            <Identifier value={tx.txId} href={`/transaction/${tx.txId}`} head={8} tail={6} />
          </div>
          <p className="mt-1 mg-caption text-text-2">
            Fee <Amount lovelace={model.fee} />
          </p>
        </div>
        <Connectors facts={outputFacts} maxLovelace={maxLovelace} direction="out" />
        <div>
          <p className="mb-1 mg-overline text-text-3 lg:hidden">Produced outputs</p>
          <Column side={model.outputs} kind="output" />
        </div>
      </div>
    </div>
  );
}

function FlowLegend() {
  return (
    <div
      data-testid="flow-legend"
      className="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-2 mg-caption text-text-3 lg:flex"
    >
      <span className="font-medium text-text-2">Lines</span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="w-5 border-t-2 border-graph-script" /> script
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="w-5 border-t-2 border-graph-key" /> key
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="w-5 border-t-2 border-dashed border-warning" /> unresolved
      </span>
      <span>Width tracks lovelace within this transaction.</span>
    </div>
  );
}

/** The one fact the diagram's shape cannot carry: why lines route through the
 * transaction rather than from an input to an output.
 *
 * Outside `FlowLegend` on purpose. The legend is desktop-only because it
 * describes lines that only the desktop layout draws, but this holds at every
 * width, and folding it into the legend silently dropped it on mobile. */
function FlowRouting() {
  return (
    <p className="mt-3 mg-caption text-text-3">
      Lines route through the transaction: the ledger does not record which input funded which
      output.
    </p>
  );
}

export function UtxoFlow({ tx }: { tx: TransactionView }) {
  const totalNodes = tx.inputs.length + tx.outputs.length + 1;
  const large = totalNodes >= LARGE_FLOW_THRESHOLD;
  const [interactive, setInteractive] = useState(false);
  /* The canvas is a separately fetched chunk, so "has it arrived" is a fact
   * this view knows and nothing else can see. Publishing it keeps a reader
   * informed and lets a test wait on the state rather than on a duration. */
  const [canvasState, setCanvasState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const onCanvasSettled = useCallback((outcome: "ready" | "error") => setCanvasState(outcome), []);

  return (
    <div
      role="group"
      aria-label="UTxO flow"
      data-layout-state={interactive ? "interactive" : "static"}
      data-canvas-state={canvasState}
    >
      {interactive ? (
        <InteractiveFlow tx={tx} onSettled={onCanvasSettled} />
      ) : (
        <StaticFlow tx={tx} large={large} />
      )}

      {large ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="mg-caption text-text-3">
            {interactive
              ? `Interactive canvas contains all ${totalNodes} nodes.`
              : `${totalNodes} nodes total. The fitted view groups the remainder.`}
          </p>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1.5 rounded border border-border-strong bg-surface px-3 text-sm font-medium text-text-2 hover:bg-surface-2 hover:text-text"
            onClick={() =>
              setInteractive((current) => {
                setCanvasState(current ? "idle" : "loading");
                return !current;
              })
            }
            aria-pressed={interactive}
          >
            <Icon name={interactive ? "layers" : "eye"} size={15} />
            {interactive ? "Return to fitted view" : `Open all ${totalNodes} nodes`}
          </button>
        </div>
      ) : null}

      <FlowLegend />
      <FlowRouting />
    </div>
  );
}
