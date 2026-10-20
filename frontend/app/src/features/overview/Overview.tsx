"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { MetricsResponse, RecentBlockRow, RecentTxRow } from "@midgard-explorer/contracts";
import type { CardanoActivitySummary } from "../../lib/api";
import { OverviewHeader } from "./OverviewHeader";
import { SearchBox } from "../../components/search/SearchOverlay";
import { BRIDGE } from "../../lib/nav";
import { Icon } from "../../components/ui/base/icons";
import { Identifier, ShortId } from "../../components/ui/domain/identifier";
import { NewRowsBanner, useHeldList } from "../../components/ui/base/livelist";
import { HourlyChart, NetworkMetrics } from "../../components/ui/domain/metrics";
import { Missing } from "../../components/ui/domain/metrics/figures";
import { StatusMark, statusOf, statusTextClass } from "../../components/ui/domain/status";
import {
  EmptyState,
  ErrorState,
  L1L2Badge,
  Panel,
  RetryButton,
} from "../../components/ui/base/layout";
import { Timestamp } from "../../components/ui/base/timestamp";
import { cn, groupThousands } from "../../lib/format";
import type { StatusTone } from "../../lib/status-registry";
import type { GlossaryTerm } from "../../lib/glossary";
import { FieldLabel } from "../../components/ui/base/infotip";

/** Hash lengths on the latest lists, as long as one row holds at each width:
 * narrow phones (the `head` and `tail` below), phones from 390px, the stacked
 * lists from sm, the side-by-side lists from lg (the narrowest rows), and the
 * wider side-by-side rows from xl. */
const HASH_LENGTHS = {
  xs: { head: 12, tail: 10 },
  sm: { head: 27, tail: 21 },
  lg: { head: 18, tail: 14 },
  xl: { head: 27, tail: 21 },
};

/** A stable empty array: a fresh `[]` each render would make the held list
 * think its input changed on every poll. */
const EMPTY_ROWS: readonly never[] = [];

const POLL_MS = 10_000;
// Nine rows per panel where the lists sit side by side, five below that so a
// phone stays scannable; the list pages carry depth.
const RECENT_ROWS = 9;
const PHONE_ROWS = 5;

export type OverviewData = {
  recentBlocks: readonly RecentBlockRow[] | null;
  recentTxs: readonly RecentTxRow[] | null;
  totalBlocks: number | null;
  totalTxs: number | null;
  metrics: MetricsResponse | null;
  l1: CardanoActivitySummary | null;
};

async function fetchOverview(): Promise<OverviewData> {
  // Same-origin route handler; the payload was Effect-validated server-side.
  const res = await fetch("/api/overview");
  if (!res.ok) throw new Error(`overview poll failed (${res.status})`);
  return await res.json();
}

/** A fetch takes about a tenth of a second, which on its own reads as a
 * flicker. The icon keeps turning this long after one ends. */
const MIN_SPIN_MS = 700;

/** How long since the overview last checked: "now", then the seconds. While a
 * check runs, a turning icon takes the text's place, and the timer comes back
 * when it is done. A screen reader hears the full phrase. */
function RefreshMeta({ updatedAt, fetching }: { updatedAt: number; fetching: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [settling, setSettling] = useState(false);
  const [wasFetching, setWasFetching] = useState(fetching);
  if (fetching !== wasFetching) {
    setWasFetching(fetching);
    if (!fetching) setSettling(true);
  }
  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => setSettling(false), MIN_SPIN_MS);
    return () => clearTimeout(t);
  }, [settling]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  // A fixed width, so the swap between icon and text does not shift the header.
  return (
    <span className="inline-flex h-5 min-w-7 items-center justify-end mg-caption tabular-nums text-text-3">
      {fetching || settling ? (
        <>
          <Icon name="refresh" size={13} className="motion-safe:animate-spin" />
          <span className="sr-only">Checking</span>
        </>
      ) : s < 5 ? (
        <>
          <span className="sr-only">Checked </span>now
        </>
      ) : (
        <>
          <span className="sr-only">Checked </span>
          {s}s<span className="sr-only"> ago</span>
        </>
      )}
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
        {held.rows.slice(0, RECENT_ROWS).map((r, i) => (
          <li
            key={keyOf(r)}
            className={cn(
              "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-surface-2",
              !initialKeys.has(keyOf(r)) && "mg-tint",
              i >= PHONE_ROWS && "max-lg:hidden",
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
  const { data, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    initialData: initial,
    staleTime: 5_000,
    refetchInterval: POLL_MS,
  });

  const sectionState = (section: unknown): "error" | "success" =>
    section === null ? "error" : "success";
  // Each list carries its own hourly chart, from the one metrics series.
  const series = data.metrics?.series ?? null;
  const hours = data.metrics?.window.hours ?? 24;

  return (
    <>
      <OverviewHeader>
        <SearchBox variant="hero" />
      </OverviewHeader>

      <NetworkMetrics
        metrics={data.metrics}
        totalBlocks={data.totalBlocks}
        totalTxs={data.totalTxs}
        freshness={<RefreshMeta updatedAt={dataUpdatedAt} fetching={isFetching} />}
        onRetry={() => void refetch()}
      />
      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Latest blocks" actions={<ViewAll href="/blocks" label="View all" />}>
          <HourlyChart series={series} measure="blocks" hours={hours} />
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
                  {/* The number leads, as on the blocks list. A block with no
                      number is named by its hash. */}
                  <span className="flex flex-wrap items-center gap-2">
                    {r.height === null ? (
                      <Identifier
                        value={r.header_hash}
                        href={`/block/${r.header_hash}`}
                        head={10}
                        tail={8}
                        breakpoints={HASH_LENGTHS}
                      />
                    ) : (
                      <Link
                        href={`/block/${r.header_hash}`}
                        className="font-mono font-semibold tabular-nums text-link hover:text-link-hover hover:underline"
                      >
                        Block #{r.height}
                      </Link>
                    )}
                    {/* No mark until the node records a settlement attempt. */}
                    {r.finalization_status === null ? null : (
                      <StatusMark status={r.finalization_status} />
                    )}
                  </span>
                  {/* A numbered block keeps its hash in a caption. Its counts
                      are on the block page. */}
                  {r.height === null ? null : (
                    <span className="mg-caption font-mono text-text-3">
                      <ShortId value={r.header_hash} head={8} tail={6} />
                    </span>
                  )}
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
          <HourlyChart series={series} measure="transactions" hours={hours} />
          <RecentList
            rows={data.recentTxs}
            state={sectionState(data.recentTxs)}
            keyOf={(r) => `${r.tx_id}:${r.header_hash}`}
            errorMessage="Could not load recent transactions."
            onRetry={() => void refetch()}
            emptyTitle="No transactions yet"
            emptyHint="Submitted transactions appear here as the node processes them."
            noun="transaction"
            render={(r) => (
              <>
                {/* One line: the transaction and how far it got. Its block is on
                    the transaction page and the transactions list. */}
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Identifier
                    value={r.tx_id}
                    href={`/transaction/${r.tx_id}`}
                    head={10}
                    tail={8}
                    breakpoints={HASH_LENGTHS}
                  />
                  {/* Its block's Cardano settlement once the node recorded one,
                      until then its state on Midgard. */}
                  <StatusMark status={r.finalization_status ?? r.status} />
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

const KIND_LABEL: Record<CardanoActivitySummary["byKind"][number]["kind"], string> = {
  settlement: "Block settlements",
  deposit: "Deposits",
  withdrawal: "Withdrawals",
  forced_transaction: "Forced transactions",
};

/** Each count's explanation, from the shared glossary. */
const KIND_TERM: Record<keyof typeof KIND_LABEL, GlossaryTerm> = {
  settlement: "blockSettlements",
  deposit: "bridgeDeposits",
  withdrawal: "bridgeWithdrawals",
  forced_transaction: "bridgeForced",
};

/** Least advanced first: a kind shows the state of the record that most needs
 * watching, so one waiting withdrawal is not hidden behind finished ones. */
const TONE_RANK: Record<StatusTone, number> = {
  danger: 4,
  warning: 3,
  neutral: 2,
  info: 1,
  success: 0,
};

type StatusCounts = CardanoActivitySummary["byKind"][number]["byStatus"];

const statusName = (status: string | null) => status ?? "unknown";

function leadStatus(byStatus: StatusCounts): string | null {
  const [lead] = [...byStatus]
    .filter((s) => s.count > 0)
    .sort(
      (a, b) =>
        TONE_RANK[statusOf(statusName(b.status)).tone] -
        TONE_RANK[statusOf(statusName(a.status)).tone],
    );
  return lead === undefined ? null : statusName(lead.status);
}

/** One count per kind, coloured by the state of its records, with the mark
 * carrying the breakdown ("5 Finalized, 1 Awaiting") for a reader who cannot
 * rely on colour. */
function KindFigure({
  label,
  term,
  count,
  byStatus,
}: {
  label: string;
  term: GlossaryTerm;
  count: number | null;
  byStatus: StatusCounts;
}) {
  const lead = count === null ? null : leadStatus(byStatus);
  return (
    <div className="min-w-0 text-center">
      <dt className="mg-caption text-text-2">
        <FieldLabel label={label} term={term} />
      </dt>
      <dd className="mt-1 flex items-center justify-center gap-2">
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            count === null ? "text-text-3" : lead === null ? "text-text" : statusTextClass(lead),
          )}
        >
          {count === null ? <Missing /> : groupThousands(String(count))}
        </span>
        {lead === null ? null : (
          <StatusMark
            status={lead}
            label={byStatus
              .map((s) => `${s.count} ${statusOf(statusName(s.status)).label.toLowerCase()}`)
              .join(", ")}
          />
        )}
      </dd>
    </div>
  );
}

/** Cardano totals and bridge navigation share one panel without mixing their
 * counts. When the counts fail, the panel keeps its figures at their default
 * and offers a retry beside its link. */
export function L1Activity({
  summary,
  onRetry,
}: {
  summary: CardanoActivitySummary | null;
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
      actions={
        <span className="flex items-center gap-2">
          {summary === null ? <RetryButton onRetry={onRetry} /> : null}
          <ViewAll href="/l1" label="View activity" />
        </span>
      }
      className="mb-4 border-l-2 border-l-info/60"
    >
      {/* Every kind, always, and the same layout when the counts are missing:
          only the values change, to their default. */}
      {/* One list, every group a direct child, so each label stays paired
          with its value for assistive technology. */}
      <dl className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-4">
        {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((kind) => {
          const own = summary?.byKind.find((k) => k.kind === kind);
          return (
            <KindFigure
              key={kind}
              label={KIND_LABEL[kind]}
              term={KIND_TERM[kind]}
              count={summary === null ? null : (own?.count ?? 0)}
              byStatus={own?.byStatus ?? []}
            />
          );
        })}
        <div className="col-span-full -mt-1 border-t border-border pt-3 text-center">
          <dt className="mg-caption text-text-2">
            <FieldLabel label="Records" term="cardanoRecords" />
          </dt>
          <dd
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              summary === null ? "text-text-3" : "text-text",
            )}
          >
            {summary === null ? <Missing /> : groupThousands(String(summary.total))}
          </dd>
        </div>
      </dl>
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
