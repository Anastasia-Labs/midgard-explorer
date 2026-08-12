"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { MetricsResponse, RecentBlockRow, RecentTxRow } from "@midgard-explorer/contracts";
import type { L1Summary } from "../../lib/api";
import { SearchBox } from "../../components/search/SearchOverlay";
import { BRIDGE } from "../../lib/nav";
import { Icon, type IconName } from "../../components/ui/icons";
import { Identifier } from "../../components/ui/identifier";
import { NewRowsBanner, useHeldList } from "../../components/ui/livelist";
import { NetworkMetrics } from "../../components/ui/metrics";
import { StatusCell } from "../../components/ui/status";
import { EmptyState, ErrorState, L1L2Badge, Panel } from "../../components/ui/primitives";
import { Timestamp } from "../../components/ui/timestamp";
import { cn, groupThousands } from "../../lib/format";
import { useHydrated } from "../../lib/useHydrated";

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
    <span className="inline-flex items-center gap-1.5 mg-caption text-text-3">
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
              "flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2",
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

  // The health query is client-only, so the server always renders "checking…".
  // Reading its result before hydration lets a fast fetch win the race and
  // produce a server/client mismatch, which React resolves by throwing away
  // the server HTML for this subtree.
  const hydrated = useHydrated();

  const sectionState = (section: unknown): "error" | "success" =>
    section === null ? "error" : "success";
  const up = hydrated ? health.data?.up : undefined;

  return (
    <>
      {/* Title and search on one line, live status centred beneath them. The
          subtitle that used to sit under the title described what the
          navigation already lists and what the panels below already show, so
          it spent a row of vertical space restating the page. `PageHeader` is
          not used here: it stacks meta under the title at the left margin,
          which is right for the eighteen record pages and wrong for this one.

          Flex, not grid. A single implicit grid column is sized to max-content
          and will not shrink, so the title held a 365px column inside a 288px
          header and pushed the whole page past 320px. Flex items shrink. */}
      <header className="mb-5">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <h1 className="mg-brand-green min-w-0 font-display text-[21px] font-semibold tracking-tight text-page-title sm:text-[26px]">
            Midgard Blockchain Explorer
          </h1>
          <div className="w-full sm:w-96 lg:w-112">
            <SearchBox variant="hero" />
          </div>
        </div>

        <div className="mg-field-surface mx-auto mt-2.5 flex w-fit flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <RefreshMeta updatedAt={dataUpdatedAt} />
          <span
            className={cn(
              "inline-flex items-center gap-1.5 mg-caption",
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
        </div>
      </header>

      {/* The operations panel leads the page: an explorer's first question is
          whether the chain is healthy right now, which two all-time totals in
          a strip could never answer. Those totals moved into its header. */}
      <NetworkMetrics
        metrics={data.metrics}
        totalBlocks={data.totalBlocks}
        totalTxs={data.totalTxs}
      />

      {/* Sits directly under the health verdict because it is the one part of
          this page that stays true when the node is offline. The verdict above
          tells a reader the ledger figures have gone quiet; without this they
          would have no way to see that Midgard is nonetheless present on
          Cardano, and would reasonably conclude the whole thing is dead. */}
      <L1Activity summary={data.l1} />

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
            noun="block"
            render={(r) => (
              <>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Link
                      href={`/block/${r.header_hash}`}
                      className="font-mono text-[15px] font-semibold tabular-nums text-link hover:text-link-hover hover:underline"
                    >
                      #{r.height}
                    </Link>
                    {r.finalization_status === null ? null : (
                      <StatusCell status={r.finalization_status} />
                    )}
                  </span>
                  <span className="mg-caption text-text-3">
                    {r.tx_count} {r.tx_count === 1 ? "transaction" : "transactions"}
                  </span>
                </span>
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
            noun="transaction"
            render={(r) => (
              <>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={8} />
                  <span className="flex items-center gap-2 mg-caption text-text-3">
                    <StatusCell status={r.status} />
                    <Link
                      href={`/block/${r.header_hash}`}
                      className="tabular-nums text-link hover:text-link-hover hover:underline"
                    >
                      #{r.height}
                    </Link>
                  </span>
                </span>
                <Timestamp iso={r.time_stamp_tz} />
              </>
            )}
          />
        </Panel>
      </div>

      <div className="mb-4">
        <Panel title="Bridge" subtitle="Assets moving in and out of Midgard">
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
        </Panel>
      </div>

      <details className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold text-text">
          How the Midgard ledger works
          <span className="ml-2 font-sans mg-caption font-normal text-text-3">
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
              <span className="flex items-center gap-2 text-info">
                <Icon name={c.icon} size={15} />
                <span className="text-sm font-semibold text-text">{c.title}</span>
              </span>
              <p className="mt-2 mg-caption leading-relaxed text-text-2">{c.body}</p>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

/** Midgard's footprint on Cardano, summarised.
 *
 * Contract names are shown as-is from the manifest rather than prettified: a
 * reader matching this against the chain or the codebase needs the identifier
 * they will actually find there, not a nicer label for it.
 */
function L1Activity({ summary }: { summary: L1Summary | null }) {
  if (summary === null || summary.transactions === 0) return null;

  const top = [...summary.byValidator].sort((a, b) => b.count - a.count).slice(0, 6);

  return (
    <section className="mb-4 rounded-lg border border-border bg-surface p-4 shadow-(--mg-shadow)">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold text-text">
          Midgard on Cardano preprod
        </h2>
        <ViewAll href="/l1" label="View all" />
      </div>

      <p className="mb-3 text-[13px] leading-relaxed text-text-2">
        <strong className="font-semibold text-text tabular-nums">
          {groupThousands(String(summary.transactions))}
        </strong>{" "}
        L1 transactions carrying{" "}
        <strong className="font-semibold text-text tabular-nums">
          {groupThousands(String(summary.events))}
        </strong>{" "}
        contract events, indexed from block height 0 up to block{" "}
        <span className="font-mono tabular-nums">
          {groupThousands(String(summary.lastSyncedHeight))}
        </span>
        .
      </p>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {top.map((v) => (
          <li key={v.validator} className="mg-caption text-text-3">
            <span className="text-text-2">{v.validator}</span>{" "}
            <span className="tabular-nums">{v.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
