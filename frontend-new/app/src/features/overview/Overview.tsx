"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { MetricsResponse, RecentBlockRow, RecentTxRow } from "@midgard-explorer/contracts";
import type { L1Summary } from "../../lib/api";
import { OverviewHeader } from "./OverviewHeader";
import { SearchBox } from "../../components/search/SearchOverlay";
import { BRIDGE } from "../../lib/nav";
import { Icon } from "../../components/ui/base/icons";
import { Identifier } from "../../components/ui/domain/identifier";
import { NewRowsBanner, useHeldList } from "../../components/ui/base/livelist";
import { NetworkMetrics } from "../../components/ui/domain/metrics";
import { StatusBadge } from "../../components/ui/domain/status";
import { EmptyState, ErrorState, L1L2Badge, Panel } from "../../components/ui/base/layout";
import { Timestamp } from "../../components/ui/base/timestamp";
import { cn, groupThousands } from "../../lib/format";

/** A stable empty array: a fresh `[]` each render would make the held list
 * think its input changed on every poll. */
const EMPTY_ROWS: readonly never[] = [];

const POLL_MS = 10_000;
// Five rows per panel keeps the overview scannable on a phone; the list pages
// carry depth.
const RECENT_ROWS = 5;

export type OverviewData = {
  recentBlocks: readonly RecentBlockRow[] | null;
  recentTxs: readonly RecentTxRow[] | null;
  totalBlocks: number | null;
  totalTxs: number | null;
  metrics: MetricsResponse | null;
  l1: L1Summary | null;
};

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
    <span className="inline-flex items-center gap-1.5 mg-caption text-text-3">
      <Icon name="refresh" size={13} />
      Checked {s < 5 ? "just now" : `${s}s ago`}
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
  noun,
}: {
  rows: readonly T[] | null;
  state: "error" | "success";
  keyOf: (row: T) => string;
  render: (row: T) => ReactNode;
  emptyTitle: string;
  emptyHint: string;
  errorMessage: string;
  onRetry: () => void;
  /** Singular name for a row, used by the new-rows banner. */
  noun: string;
}) {
  // Rows present at first render never tint; rows that appear later mount
  // with mg-tint and the CSS animation runs once on mount.
  const [initialKeys] = useState(() => new Set((rows ?? []).map(keyOf)));
  // 4.2b: the poll never moves what is on screen. New rows wait behind a row
  // the reader clicks, so the row they were reading stays where it was.
  const held = useHeldList(rows ?? EMPTY_ROWS, keyOf);

  if (state === "error") return <ErrorState message={errorMessage} onRetry={onRetry} />;
  if (rows === null || held.rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }
  return (
    <>
      <NewRowsBanner count={held.pending} noun={noun} onApply={held.apply} />
      <ul className="py-1">
        {held.rows.slice(0, RECENT_ROWS).map((r) => (
          <li
            key={keyOf(r)}
            className={cn(
              "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-surface-2",
              !initialKeys.has(keyOf(r)) && "mg-tint",
            )}
          >
            {render(r)}
          </li>
        ))}
      </ul>
    </>
  );
}

function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-link transition-colors hover:bg-surface-2 hover:text-link-hover"
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

  const sectionState = (section: unknown): "error" | "success" =>
    section === null ? "error" : "success";

  return (
    <>
      <OverviewHeader>
        <SearchBox variant="hero" />
      </OverviewHeader>

      <NetworkMetrics
        metrics={data.metrics}
        totalBlocks={data.totalBlocks}
        totalTxs={data.totalTxs}
        freshness={<RefreshMeta updatedAt={dataUpdatedAt} />}
      />
      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Latest blocks" actions={<ViewAll href="/blocks" label="View all" />}>
          <RecentList
            rows={data.recentBlocks}
            state={sectionState(data.recentBlocks)}
            keyOf={(r) => r.header_hash}
            errorMessage="Could not load recent blocks."
            onRetry={() => void refetch()}
            emptyTitle="No blocks yet"
            emptyHint="Blocks appear once the node's operator starts committing."
            noun="block"
            render={(r) => (
              <>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <Identifier
                      value={r.header_hash}
                      href={`/block/${r.header_hash}`}
                      head={8}
                      tail={6}
                    />
                    {r.finalization_status === null ? null : (
                      <StatusBadge status={r.finalization_status} />
                    )}
                  </span>
                  <span className="mg-caption text-text-3">
                    {r.height === null ? null : `#${r.height} · `}
                    {r.header_l2_transaction_count} tx · {r.header_deposit_count}{" "}
                    {r.header_deposit_count === 1 ? "deposit" : "deposits"}
                  </span>
                </span>
                <Timestamp iso={r.time_stamp_tz} wrap />
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
            noun="transaction"
            render={(r) => (
              <>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={8} />
                  <span className="flex flex-wrap items-center gap-2 mg-caption text-text-3">
                    <StatusBadge status={r.status} />
                    <Link
                      href={`/block/${r.header_hash}`}
                      className="tabular-nums text-link hover:text-link-hover hover:underline"
                    >
                      {r.height === null ? `${r.header_hash.slice(0, 8)}…` : `#${r.height}`}
                    </Link>
                  </span>
                </span>
                <Timestamp iso={r.time_stamp_tz} wrap />
              </>
            )}
          />
        </Panel>
      </div>

      <L1Activity summary={data.l1} onRetry={() => void refetch()} />
    </>
  );
}

/** Cardano totals and bridge navigation share one panel without mixing their counts. */
export function L1Activity({
  summary,
  onRetry,
}: {
  summary: L1Summary | null;
  onRetry: () => void;
}) {
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2 text-info">
          <L1L2Badge layer="L1" />
          Cardano activity
        </span>
      }
      actions={<ViewAll href="/l1" label="View activity" />}
      className="mb-4 border-l-2 border-l-info/60"
    >
      <div className="px-4 py-3">
        {summary === null ? (
          <ErrorState message="Could not load Cardano activity." onRetry={onRetry} />
        ) : summary.transactions === 0 ? (
          <p className="text-sm text-text-2">No Cardano activity indexed yet.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4">
              {[
                { label: "Transactions", count: summary.transactions },
                { label: "Contract events", count: summary.events },
              ].map(({ label, count }) => (
                <div key={label} className="min-w-0">
                  <dt className="mg-caption text-text-2">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-text">
                    {groupThousands(String(count))}
                  </dd>
                </div>
              ))}
            </dl>
            {summary.lastSyncedHeight === null ? (
              <p className="mt-2 mg-micro text-warning">Index coverage unavailable.</p>
            ) : summary.sync.state !== "reconciled" ? (
              <p className="mt-2 mg-micro text-warning">Indexing in progress.</p>
            ) : null}
          </>
        )}
      </div>
      <nav aria-label="Bridge activity" className="border-t border-border">
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
              <span className="text-text-3 transition-all group-hover:translate-x-0.5 group-hover:text-link">
                <Icon name="arrowRight" size={16} />
              </span>
            </Link>
          ))}
        </div>
      </nav>
    </Panel>
  );
}
