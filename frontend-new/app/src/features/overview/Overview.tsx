"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { RecentBlockRow, RecentTxRow } from "@midgard-explorer/contracts";
import { SearchBox } from "../../components/search/SearchOverlay";
import { BRIDGE } from "../../components/shell/NavLinks";
import { Icon, type IconName } from "../../components/ui/icons";
import { Identifier } from "../../components/ui/identifier";
import {
  EmptyState,
  ErrorState,
  L1L2Badge,
  MetricStrip,
  MetricTile,
  PageHeader,
  Panel,
} from "../../components/ui/primitives";
import { Timestamp } from "../../components/ui/timestamp";
import { cn, groupThousands } from "../../lib/format";

const POLL_MS = 10_000;
const RECENT_ROWS = 7;

export type OverviewData = {
  recentBlocks: readonly RecentBlockRow[] | null;
  recentTxs: readonly RecentTxRow[] | null;
  totalBlocks: number | null;
  totalTxs: number | null;
};

/** The three Midgard-specific concepts. Keeps the overview composed and
 * informative when the network is quiet, instead of ending in empty space. */
const CONCEPTS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "activity",
    title: "Transaction lifecycle",
    body: "A transaction moves from queued through validating and accepted, waits as pending commit, then becomes committed once an L2 block includes it. Rejected transactions stop and keep their reason.",
  },
  {
    icon: "layers",
    title: "Block finalization",
    body: "The operator commits L2 blocks, then submits a finalization transaction to Cardano L1. A block is finalized only after that L1 transaction is confirmed and stable.",
  },
  {
    icon: "bridge",
    title: "L1 ↔ L2 bridge",
    body: "Deposits move value onto the L2 ledger, withdrawals move it back to L1, and forced transactions are L1-escrowed orders the operator must include.",
  },
];

async function fetchOverview(): Promise<OverviewData> {
  // Same-origin route handler; the payload was Effect-validated server-side.
  const res = await fetch("/api/overview");
  if (!res.ok) throw new Error(`overview poll failed (${res.status})`);
  return await res.json();
}

/** "Updated Xs ago" freshness tag, ticking every 5 s. */
function RefreshMeta({ updatedAt }: { updatedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-text-3">
      <Icon name="refresh" size={13} />
      Updated {s < 5 ? "just now" : `${s}s ago`}
    </span>
  );
}

/** Recent-activity row list (template RecentRowItem): denser than a table,
 * whole row is a hover target, new rows flash an accent tint. */
function RecentList<T>({
  rows,
  state,
  keyOf,
  render,
  emptyTitle,
  emptyHint,
  errorMessage,
  onRetry,
}: {
  rows: readonly T[] | null;
  state: "error" | "success";
  keyOf: (row: T) => string;
  render: (row: T) => ReactNode;
  emptyTitle: string;
  emptyHint: string;
  errorMessage: string;
  onRetry: () => void;
}) {
  // Rows present at first render never tint; rows that appear later mount
  // with mg-tint and the CSS animation runs once on mount.
  const [initialKeys] = useState(() => new Set((rows ?? []).map(keyOf)));

  if (state === "error") return <ErrorState message={errorMessage} onRetry={onRetry} />;
  if (rows === null || rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }
  return (
    <ul className="py-1">
      {rows.slice(0, RECENT_ROWS).map((r) => (
        <li
          key={keyOf(r)}
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2",
            !initialKeys.has(keyOf(r)) && "mg-tint",
          )}
        >
          {render(r)}
        </li>
      ))}
    </ul>
  );
}

function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-accent transition-colors hover:bg-surface-2"
    >
      {label}
      <Icon name="arrowRight" size={14} />
    </Link>
  );
}

export function Overview({ initial }: { initial: OverviewData }) {
  const { data, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    initialData: initial,
    staleTime: 5_000,
    refetchInterval: POLL_MS,
  });

  const health = useQuery<{ up: boolean }>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) return { up: false };
      return await res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const sectionState = (section: unknown): "error" | "success" =>
    section === null ? "error" : "success";
  const up = health.data?.up;

  return (
    <>
      <PageHeader
        title="Network overview"
        subtitle="Live activity on the Midgard Layer 2 network, anchored to Cardano L1."
        meta={
          <>
            <RefreshMeta updatedAt={dataUpdatedAt} />
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[13px]",
                up === false ? "text-danger" : "text-text-3",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  up === undefined ? "bg-text-3" : up ? "bg-success" : "bg-danger",
                )}
              />
              Explorer API {up === undefined ? "checking…" : up ? "reachable" : "unreachable"}
            </span>
          </>
        }
      />

      <div className="mb-5 max-w-2xl">
        <SearchBox variant="hero" />
      </div>

      <MetricStrip>
        <MetricTile
          label="L2 blocks"
          value={
            data.totalBlocks === null ? "Unavailable" : groupThousands(String(data.totalBlocks))
          }
          sub="Total produced"
          icon="layers"
        />
        <MetricTile
          label="L2 transactions"
          value={data.totalTxs === null ? "Unavailable" : groupThousands(String(data.totalTxs))}
          sub="Total processed"
          icon="activity"
        />
      </MetricStrip>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Latest blocks" actions={<ViewAll href="/blocks" label="View all" />}>
          <RecentList
            rows={data.recentBlocks}
            state={sectionState(data.recentBlocks)}
            keyOf={(r) => `${r.header_hash}-${r.tx_id}`}
            errorMessage="Could not load recent blocks."
            onRetry={() => void refetch()}
            emptyTitle="No blocks yet"
            emptyHint="Blocks appear once the node's operator starts committing."
            render={(r) => (
              <>
                <Identifier
                  value={r.header_hash}
                  href={`/block/${r.header_hash}`}
                  head={10}
                  tail={8}
                />
                <Timestamp iso={r.time_stamp_tz} />
              </>
            )}
          />
        </Panel>

        <Panel
          title="Latest transactions"
          actions={<ViewAll href="/transactions" label="View all" />}
        >
          <RecentList
            rows={data.recentTxs}
            state={sectionState(data.recentTxs)}
            keyOf={(r) => r.tx_id}
            errorMessage="Could not load recent transactions."
            onRetry={() => void refetch()}
            emptyTitle="No transactions yet"
            emptyHint="Submitted transactions appear here as the node processes them."
            render={(r) => (
              <>
                <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={8} />
                <Timestamp iso={r.time_stamp_tz} />
              </>
            )}
          />
        </Panel>
      </div>

      <div className="mb-4">
        <Panel title="Bridge" subtitle="Assets crossing between Cardano L1 and Midgard L2">
          <div className="grid sm:grid-cols-3">
            {BRIDGE.map((b, i) => (
              <Link
                key={b.href}
                href={b.href}
                className={cn(
                  "group flex items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-2",
                  i < BRIDGE.length - 1 && "border-b border-border sm:border-b-0 sm:border-r",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text">{b.label}</span>
                  <span className="mt-1.5 inline-flex items-center gap-1.5">
                    <L1L2Badge layer={b.from} />
                    <Icon name="arrowRight" size={12} className="text-text-3" />
                    <L1L2Badge layer={b.to} />
                  </span>
                </span>
                <span className="text-text-3 transition-all group-hover:translate-x-0.5 group-hover:text-accent">
                  <Icon name="arrowRight" size={16} />
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <details className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <summary className="cursor-pointer px-4 py-3 font-display text-[15px] font-semibold text-text">
          How the Midgard ledger works
          <span className="ml-2 font-sans text-[12.5px] font-normal text-text-3">
            What this explorer tracks, and where each record comes from
          </span>
        </summary>
        <div className="grid border-t border-border sm:grid-cols-3">
          {CONCEPTS.map((c, i) => (
            <div
              key={c.title}
              className={cn(
                "px-4 py-4",
                i < CONCEPTS.length - 1 && "border-b border-border sm:border-b-0 sm:border-r",
              )}
            >
              <span className="flex items-center gap-2 text-accent">
                <Icon name={c.icon} size={15} />
                <span className="text-sm font-semibold text-text">{c.title}</span>
              </span>
              <p className="mt-2 text-[13px] leading-relaxed text-text-2">{c.body}</p>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
