"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { MetricsResponse, RecentBlockRow, RecentTxRow } from "@midgard-explorer/contracts";
import type { L1Summary } from "../../lib/api";
import { SearchBox } from "../../components/search/SearchOverlay";
import { BRIDGE } from "../../lib/nav";
import { Icon } from "../../components/ui/icons";
import { Identifier } from "../../components/ui/identifier";
import { NewRowsBanner, useHeldList } from "../../components/ui/livelist";
import { NetworkMetrics } from "../../components/ui/metrics";
import { StatusCell } from "../../components/ui/status";
import { EmptyState, ErrorState, L1L2Badge, Panel } from "../../components/ui/primitives";
import { Timestamp } from "../../components/ui/timestamp";
import { contractName } from "../../components/ui/validatorlabel";
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

  const sectionState = (section: unknown): "error" | "success" =>
    section === null ? "error" : "success";

  return (
    <>
      {/* Title and search on one line, and nothing else. A second row carried
          an "Explorer API reachable" chip that the footer already renders from
          the same query, and a freshness tag that describes the metrics rather
          than the page; the tag moved to the panel it qualifies. `PageHeader` is
          not used here: it stacks meta under the title at the left margin,
          which is right for the eighteen record pages and wrong for this one.

          Flex, not grid. A single implicit grid column is sized to max-content
          and will not shrink, so the title held a 365px column inside a 288px
          header and pushed the whole page past 320px. Flex items shrink. */}
      {/* Bleeds to the shell's gutters so the wash starts at the page edge
          rather than inside the content column. The insets mirror `main`'s
          `px-4 lg:px-6` exactly; any other pair would push the page wider than
          the viewport. */}
      <header className="mg-hero-field -mx-4 mb-5 px-4 pt-2 pb-1 lg:-mx-6 lg:px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <h1 className="mg-brand-green min-w-0 font-display text-2xl font-semibold tracking-tight text-page-title sm:text-title">
            Midgard Blockchain Explorer
          </h1>
          <div className="w-full sm:w-96 lg:w-112">
            <SearchBox variant="hero" />
          </div>
        </div>
      </header>

      {/* The operations panel leads the page: an explorer's first question is
          whether the chain is healthy right now, which two all-time totals in
          a strip could never answer. Those totals are carried by the Blocks and
          Transactions figures inside it. The chart, percentiles and node
          columns sit behind this panel's own disclosure rather than a separate
          route: a dedicated page for them was not worth a navigation when the
          whole panel already fits here. */}
      <NetworkMetrics
        metrics={data.metrics}
        totalBlocks={data.totalBlocks}
        totalTxs={data.totalTxs}
        freshness={<RefreshMeta updatedAt={dataUpdatedAt} />}
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
            keyOf={(r) => r.header_hash}
            errorMessage="Could not load recent blocks."
            onRetry={() => void refetch()}
            emptyTitle="No blocks yet"
            emptyHint="Blocks appear once the node's operator starts committing."
            noun="block"
            render={(r) => (
              <>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Identifier
                      value={r.header_hash}
                      href={`/block/${r.header_hash}`}
                      head={8}
                      tail={6}
                    />
                    {r.finalization_status === null ? null : (
                      <StatusCell status={r.finalization_status} />
                    )}
                  </span>
                  <span className="mg-caption text-text-3">
                    {r.height === null ? null : `#${r.height} · `}
                    {r.header_l2_transaction_count} tx · {r.header_deposit_count} deposits
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
                      {r.height === null ? `${r.header_hash.slice(0, 8)}…` : `#${r.height}`}
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
        <h2 className="font-display text-body font-semibold text-text">
          Midgard on Cardano preprod
        </h2>
        <ViewAll href="/l1" label="View all" />
      </div>

      {/* What Midgard has done on Cardano, not how the explorer came to know
          it. The synced height is the one number here that qualifies the other
          two rather than reporting activity, so it goes last and quietly. */}
      <p className="mb-3 text-caption leading-relaxed text-text-2">
        <strong className="font-semibold text-text tabular-nums">
          {groupThousands(String(summary.transactions))}
        </strong>{" "}
        Cardano transactions carrying{" "}
        <strong className="font-semibold text-text tabular-nums">
          {groupThousands(String(summary.events))}
        </strong>{" "}
        Midgard contract events.
      </p>

      {/* Which mechanism drove the activity, not just how much of it there
          was. Raw identifiers (`stateQueue`, `registeredOperators`) are the
          contract's own vocabulary, not a reader's; `contractName` is the same
          prettifier the L1 transaction list uses for the same identifiers. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {top.map((v) => (
          <li key={v.validator} className="mg-caption text-text-3">
            <span className="text-text-2">{contractName(v.validator)}</span>{" "}
            <span className="tabular-nums">{v.count}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 mg-micro text-text-3">
        Indexed through Cardano block{" "}
        <span className="font-mono tabular-nums">
          {groupThousands(String(summary.lastSyncedHeight))}
        </span>
        .
      </p>
    </section>
  );
}
