import type { MetricsResponse, Percentile } from "@midgard-explorer/contracts";
import Link from "next/link";
import { cn, formatDuration, formatTimestamp, groupThousands } from "../../lib/format";
import { Icon } from "./icons";
import { Panel } from "./primitives";
import { StatusBadge } from "./status";

/** The operations panel.
 *
 * The rule that shapes every piece of this file: a figure is only worth showing
 * if a reader can tell how much to trust it. So each one carries the sample it
 * was measured over, the window it covers, and the node column it came from.
 * A dashboard that shows a p95 across four records as though it were a
 * measurement is not informative, it is confidently wrong, and an operator who
 * discovers that once will never trust the panel again.
 *
 * Charts are hand-drawn SVG rather than a charting library: three shapes do not
 * justify a dependency, and inline SVG has no runtime to hydrate.
 */

/** Below this, a percentile is a description of a handful of records rather
 * than a distribution, and the UI says so instead of implying otherwise. */
const THIN_SAMPLE = 20;

function Figure({
  label,
  value,
  sub,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  hint?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3" title={hint}>
      <p className="mg-overline">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-[19px] font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          tone === "neutral" && "text-text",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[12px] text-text-3">{sub}</p> : null}
    </div>
  );
}

/** A percentile pair, presented with the sample that produced it. */
function Latency({ label, p, hint }: { label: string; p: Percentile; hint?: string }) {
  const thin = p.sampleCount > 0 && p.sampleCount < THIN_SAMPLE;
  return (
    <Figure
      label={label}
      value={p.p50Ms === null ? "No data" : formatDuration(p.p50Ms)}
      tone={p.p50Ms === null ? "neutral" : "neutral"}
      hint={hint ?? p.source}
      sub={
        p.sampleCount === 0 ? (
          "Nothing completed in this window"
        ) : (
          <>
            p95 {p.p95Ms === null ? "unknown" : formatDuration(p.p95Ms)}
            <span className={cn("block", thin && "text-warning")}>
              {thin ? "thin sample: " : "over "}
              {p.sampleCount} {p.sampleCount === 1 ? "record" : "records"}
            </span>
          </>
        )
      }
    />
  );
}

/** Hourly production over the window.
 *
 * Bars rather than a line: production is a count per hour, and a line between
 * two counts implies values in between that were never measured. An hour with
 * no blocks draws as a marked gap, because that is the single most important
 * thing this chart can tell an operator. */
function ProductionChart({ series }: { series: MetricsResponse["series"] }) {
  if (series.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-text-3">
        No production history in this window.
      </p>
    );
  }

  const peak = Math.max(...series.map((s) => s.blocks), 1);
  const width = 100;
  const height = 34;
  const gap = 0.35;
  const barWidth = width / series.length - gap;
  const outages = series.filter((s) => s.blocks === 0).length;

  return (
    <figure className="px-4 pt-3 pb-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="mg-overline">Blocks per hour</span>
        <span className="text-[12px] text-text-3">
          peak {peak}
          {outages > 0 ? (
            <span className="ml-1.5 text-warning">
              · {outages} {outages === 1 ? "hour" : "hours"} with no blocks
            </span>
          ) : null}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-2 h-16 w-full"
        role="img"
        aria-label={`Blocks per hour across ${series.length} hours. Peak ${peak} blocks. ${
          outages === 0 ? "No empty hours." : `${outages} hours produced no blocks.`
        }`}
      >
        {series.map((s, i) => {
          const h = (s.blocks / peak) * height;
          const x = i * (barWidth + gap);
          return s.blocks === 0 ? (
            // An empty hour gets a floor mark rather than nothing, so a gap in
            // production is visibly a gap and not a rendering failure.
            <rect
              key={s.hour}
              x={x}
              y={height - 1}
              width={barWidth}
              height={1}
              className="fill-warning"
            />
          ) : (
            <rect
              key={s.hour}
              x={x}
              y={height - h}
              width={barWidth}
              height={h}
              className="fill-accent/70"
            >
              <title>{`${formatTimestamp(s.hour)} · ${s.blocks} blocks · ${s.transactions} transactions`}</title>
            </rect>
          );
        })}
      </svg>
      <p className="mt-1 flex justify-between text-[11px] text-text-3">
        <span>{formatTimestamp(series[0]!.hour)}</span>
        <span>{formatTimestamp(series[series.length - 1]!.hour)}</span>
      </p>
    </figure>
  );
}

/** Proportional bar for a set of statuses, so an unrecognized code is visible
 * as its own share rather than folded into a bucket the explorer invented. */
function StatusBar({ counts }: { counts: readonly { status: string; count: number }[] }) {
  const total = counts.reduce((n, c) => n + c.count, 0);
  if (total === 0) return null;
  return (
    <div className="px-4 py-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
        {counts.map((c) => (
          <span
            key={c.status}
            className={cn(
              "h-full",
              c.status === "finalized" || c.status === "accepted" || c.status === "consumed"
                ? "bg-success"
                : c.status === "abandoned" || c.status === "rejected"
                  ? "bg-danger"
                  : "bg-info/70",
            )}
            style={{ width: `${(c.count / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {counts.map((c) => (
          <li key={c.status} className="flex items-center gap-1.5 text-[12px]">
            <StatusBadge status={c.status} />
            <span className="tabular-nums text-text-2">{groupThousands(String(c.count))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tip age against the observed block interval. A fixed threshold would be
 * wrong on any chain whose cadence differs from the one it was written for, so
 * lateness is judged against what this node actually does. */
function tipTone(
  ageSeconds: number | null,
  p50: number | null,
): { tone: "success" | "warning" | "danger" | "neutral"; note: string } {
  if (ageSeconds === null) return { tone: "neutral", note: "No blocks recorded" };
  if (p50 === null || p50 <= 0) {
    return { tone: "neutral", note: "No interval measured yet, so lateness cannot be judged" };
  }
  const ratio = ageSeconds / p50;
  if (ratio <= 2) return { tone: "success", note: `Within the usual ${Math.round(p50)}s cadence` };
  if (ratio <= 5) {
    return { tone: "warning", note: `${ratio.toFixed(1)}× the usual ${Math.round(p50)}s cadence` };
  }
  return { tone: "danger", note: `${ratio.toFixed(1)}× the usual ${Math.round(p50)}s cadence` };
}

/** All-time counts sit in the header rather than among the figures: they answer
 * "how big is this chain", which is a different question from "how is it doing
 * right now", and mixing the two invites reading a 24 hour number as a total. */
function AllTime({ blocks, txs }: { blocks: number | null; txs: number | null }) {
  if (blocks === null && txs === null) return null;
  return (
    <span className="text-[12.5px] text-text-3">
      All time:{" "}
      <strong className="font-semibold tabular-nums text-text-2">
        {blocks === null ? "unknown" : groupThousands(String(blocks))}
      </strong>{" "}
      blocks ·{" "}
      <strong className="font-semibold tabular-nums text-text-2">
        {txs === null ? "unknown" : groupThousands(String(txs))}
      </strong>{" "}
      transactions
    </span>
  );
}

export function NetworkMetrics({
  metrics,
  totalBlocks,
  totalTxs,
}: {
  metrics: MetricsResponse | null;
  totalBlocks: number | null;
  totalTxs: number | null;
}) {
  if (metrics === null) {
    return (
      <Panel
        title="Network health"
        subtitle="Operational metrics from the node's own tables"
        actions={<AllTime blocks={totalBlocks} txs={totalTxs} />}
        className="mb-4"
      >
        <p className="px-4 py-6 text-center text-[13px] text-text-3">
          Metrics are unavailable. Everything else on this page is unaffected.
        </p>
      </Panel>
    );
  }

  const { window: w, tip, throughput, admission, finality } = metrics;
  const tipState = tipTone(tip.ageSeconds, throughput.blockIntervalSeconds.p50);
  const backlogTone = finality.pending === 0 ? "success" : finality.pending > 50 ? "warning" : "neutral";

  return (
    <Panel
      title="Network health"
      // The caveat is one clause here and a full sentence in the disclosure.
      // A three-line subtitle pushed the figures themselves off a phone, which
      // is a worse outcome than a terse warning that expands.
      subtitle={
        w.partial
          ? `Last ${w.hours}h · partial: the node holds history only from ${formatTimestamp(
              w.observedFrom ?? w.start,
            )}`
          : `Last ${w.hours} hours`
      }
      actions={<AllTime blocks={totalBlocks} txs={totalTxs} />}
      className="mb-4"
    >
      <div
        data-region="metrics"
        className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5"
      >
        <Figure
          label="Chain tip"
          value={tip.height === null ? "None" : `#${groupThousands(String(tip.height))}`}
          sub={
            tip.ageSeconds === null ? "No blocks" : `${formatDuration(tip.ageSeconds * 1000)} ago`
          }
          tone={tipState.tone}
          hint={`${tipState.note} · ${tip.source}`}
        />
        <Figure
          label="Blocks"
          value={groupThousands(String(throughput.blocks))}
          sub={
            throughput.blockIntervalSeconds.p50 === null
              ? "Interval not measured"
              : `every ${Math.round(throughput.blockIntervalSeconds.p50)}s (p50)`
          }
          hint={throughput.source}
        />
        <Figure
          label="Transactions"
          value={groupThousands(String(throughput.transactions))}
          sub={
            throughput.transactionsPerBlock === null
              ? "No blocks in window"
              : `${throughput.transactionsPerBlock.toFixed(1)} per block`
          }
          hint={throughput.source}
        />
        <Latency label="Admission" p={admission.latency} />
        <Latency label="L1 settlement" p={finality.settlementLatency} />
      </div>

      <div className="grid divide-y divide-border border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <ProductionChart series={metrics.series} />

        <div>
          <div className="grid grid-cols-2 divide-x divide-border">
            <Figure
              label="Awaiting L1"
              value={groupThousands(String(finality.pending))}
              sub={`${finality.finalized} settled · ${finality.abandoned} abandoned`}
              tone={backlogTone}
              hint={finality.source}
            />
            <Figure
              label="Admission queue"
              value={groupThousands(String(admission.queueDepth))}
              sub={
                admission.rejectionRate === null
                  ? "No decisions in window"
                  : `${(admission.rejectionRate * 100).toFixed(1)}% rejected (${admission.rejected} of ${
                      admission.accepted + admission.rejected
                    })`
              }
              tone={
                admission.rejectionRate !== null && admission.rejectionRate > 0.25
                  ? "warning"
                  : "neutral"
              }
              hint={admission.source}
            />
          </div>

          {finality.oldestUnsettled ? (
            <div className="border-t border-border px-4 py-3">
              <p className="mg-overline">Oldest block awaiting L1</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                <Link
                  href={`/block/${finality.oldestUnsettled.headerHash}`}
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  {finality.oldestUnsettled.headerHash.slice(0, 12)}…
                  <Icon name="arrowRight" size={11} />
                </Link>
                <StatusBadge status={finality.oldestUnsettled.status} />
                <span className="tabular-nums text-text-2">
                  waiting {formatDuration(finality.oldestUnsettled.waitingSeconds * 1000)}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <details className="border-t border-border">
        <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-medium text-text-2 hover:text-text">
          Status breakdown and where each figure comes from
        </summary>
        <div className="border-t border-border">
          <h3 className="px-4 pt-3 mg-overline">Block finalization</h3>
          <StatusBar counts={metrics.statusBreakdown.finalization} />
          <h3 className="border-t border-border px-4 pt-3 mg-overline">
            Transaction admission ({w.hours}h)
          </h3>
          <StatusBar counts={metrics.statusBreakdown.admission} />
          <dl className="border-t border-border px-4 py-3 text-[12px]">
            {(
              [
                ["Chain tip", tip.source],
                ["Throughput", throughput.source],
                ["Admission latency", admission.latency.source],
                ["Settlement latency", finality.settlementLatency.source],
                ["Finality backlog", finality.source],
              ] as const
            ).map(([label, source]) => (
              <div key={label} className="flex flex-wrap justify-between gap-x-4 py-0.5">
                <dt className="text-text-3">{label}</dt>
                <dd className="font-mono text-text-2">{source}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-border px-4 py-2.5 text-[12px] leading-relaxed text-text-3">
            Window {formatTimestamp(w.start)} to {formatTimestamp(w.end)}.
            {w.partial
              ? ` The node's earliest block is ${formatTimestamp(
                  w.observedFrom ?? w.start,
                )}, so every throughput figure above describes less than ${w.hours} hours of production and should not be read as a daily rate.`
              : ""}{" "}
            Percentiles are computed in Postgres over the records in that window; a sample below{" "}
            {THIN_SAMPLE} records is labelled rather than smoothed. Backlog counts are not windowed,
            because a block stuck for days is exactly what this panel exists to surface.
          </p>
        </div>
      </details>
    </Panel>
  );
}
