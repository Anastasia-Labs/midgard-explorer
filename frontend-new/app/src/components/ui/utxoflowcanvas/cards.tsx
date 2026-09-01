"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowGraphNode } from "../../../lib/flow";
import { formatAda } from "../../../lib/format";
import { Icon } from "../icons";
import { Chip } from "../primitives";
import { useInspection } from "./inspection";
import type { CanvasNode } from "./layout";

/**
 * One card per node in the graph.
 *
 * Drawing only. What a card shows comes from the graph node it is handed; where
 * it sits comes from ./layout, and which one is being inspected comes from
 * ./inspection.
 */

const short = (value: string, head = 8, tail = 6) =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

export function Amount({ lovelace }: { lovelace: bigint }) {
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

export function FlowCard({ data }: NodeProps<CanvasNode>) {
  const node = data.graphNode;
  const inspection = useInspection();
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
