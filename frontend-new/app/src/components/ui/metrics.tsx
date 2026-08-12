import type { MetricsResponse, Percentile } from "@midgard-explorer/contracts";
import Link from "next/link";
import { cn, formatDuration, formatTimestamp, groupThousands } from "../../lib/format";
import { networkHealth, type NetworkHealth } from "../../lib/health";
import type { GlossaryTerm } from "../../lib/glossary";
import { Icon } from "./icons";
import { FieldLabel } from "./infotip";
import { LiveValue } from "./livevalue";
import { Panel } from "./primitives";
import { StatusBadge } from "./status";
import { ViewToggle } from "./viewtoggle";

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

const VERDICT_TONE = {
  healthy: { text: "text-success", dot: "bg-success" },
  degraded: { text: "text-warning", dot: "bg-warning" },
  stalled: { text: "text-danger", dot: "bg-danger" },
  unknown: { text: "text-text-2", dot: "bg-text-3" },
} as const;

/** The panel's answer, and the largest thing on it.
 *
 * The figures below are evidence. Five of them at equal weight left the reader
 * to decide whether 43s of settlement latency and a 33% abandonment rate add up
 * to a working chain, which is precisely the judgement someone arriving at an
 * explorer has no basis to make. So the panel states its conclusion first and
 * shows its working underneath, in the same grammar every record page uses.
 *
 * The reasons are not decoration: each one names the figure it came from, so
 * disagreeing with the verdict costs a reader nothing. A judgement that cannot
 * be checked would be worth less than the numbers it sits above. */
function Verdict({ health }: { health: NetworkHealth }) {
  const tone = VERDICT_TONE[health.state];
  return (
    <div data-region="verdict" className="border-b border-border px-4 py-3.5">
      <p className="flex items-start gap-2.5">
        <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full", tone.dot)} />
        {/* Larger than the 19px figures at every width, including the phone.
            An earlier version was 19px at base and only outgrew them at `sm`,
            which left the panel with no focal point on exactly the viewport
            where having one matters most. */}
        <span
          className={cn(
            "text-[21px] leading-snug font-semibold text-balance sm:text-[26px]",
            tone.text,
          )}
        >
          {health.headline}
        </span>
      </p>
      {health.reasons.length > 0 ? (
        <ul className="mt-2 space-y-1 pl-4.5">
          {health.reasons.map((reason) => (
            <li key={reason} className="mg-caption leading-relaxed text-text-2">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  sub,
  tone = "neutral",
  hint,
  term,
  live,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  hint?: string;
  term?: GlossaryTerm | undefined;
  /** Comparable identity of the figure. Given, the value tints when it moves,
   * which is the only motion on this page that means anything. */
  live?: string | number | null;
}) {
  const figure = (
    <span
      className={cn(
        "text-[19px] font-semibold tabular-nums",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-danger",
        tone === "neutral" && "text-text",
      )}
    >
      {value}
    </span>
  );
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="mg-overline">
        <FieldLabel label={label} explain={hint} term={term} />
      </p>
      <p className="mt-1">
        {live === undefined ? figure : <LiveValue value={live}>{figure}</LiveValue>}
      </p>
      {sub ? <p className="mt-0.5 mg-micro text-text-3">{sub}</p> : null}
    </div>
  );
}

/** A percentile pair, presented with the sample that produced it.
 *
 * `emptyNote` exists because an empty sample has more than one cause. A figure
 * that reports no duration next to a count of settled blocks has to say which
 * of the two it means, or the panel contradicts itself. */
function Latency({
  label,
  p,
  hint,
  term,
  emptyNote = "Nothing completed in this window",
}: {
  label: string;
  p: Percentile;
  hint?: string;
  term?: GlossaryTerm | undefined;
  emptyNote?: string;
}) {
  const thin = p.sampleCount > 0 && p.sampleCount < THIN_SAMPLE;
  return (
    <Figure
      label={label}
      value={p.p50Ms === null ? "No data" : formatDuration(p.p50Ms)}
      tone={p.p50Ms === null ? "neutral" : "neutral"}
      hint={hint ?? p.source}
      term={term}
      sub={
        p.sampleCount === 0 ? (
          emptyNote
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

/** Hourly production over the window, for one measure at a time.
 *
 * Bars rather than a line: production is a count per hour, and a line between
 * two counts implies values in between that were never measured. An hour with
 * no blocks draws as a marked gap, because that is the single most important
 * thing this chart can tell an operator.
 *
 * One measure at a time rather than two axes. Blocks and transactions are
 * different units, and putting them on a shared axis draws a relationship the
 * data does not contain. The toggle is the same control the UTxO flow uses, so
 * "these are two views of one thing" reads the same way in both places.
 *
 * Every value is in the table below the chart. That table is visually hidden
 * but present in the accessibility tree and reachable by keyboard, which is
 * what a chart owes a reader who cannot hover: the SVG `<title>` this used to
 * rely on was invisible on touch and unreliable in screen readers, the same
 * defect the hover-only `title=` attributes had. */
function Bars({
  series,
  measure,
}: {
  series: MetricsResponse["series"];
  measure: "blocks" | "transactions";
}) {
  const values = series.map((s) => s[measure]);
  const peak = Math.max(...values, 1);
  const width = 100;
  const height = 34;
  const gap = 0.35;
  const barWidth = width / series.length - gap;
  const empty = values.filter((v) => v === 0).length;
  const noun = measure === "blocks" ? "blocks" : "transactions";

  return (
    <>
      {/* Not a `figcaption`: that has to be a direct child of its `figure`,
          and the toggle puts a wrapper in between. */}
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="mg-overline">{noun} per hour</span>
        <span className="mg-micro text-text-3">
          peak {peak}
          {empty > 0 ? (
            <span className="ml-1.5 text-warning">
              · {empty} {empty === 1 ? "hour" : "hours"} with no {noun}
            </span>
          ) : null}
        </span>
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-2 h-16 w-full"
        role="img"
        aria-label={`${noun} per hour across ${series.length} hours. Peak ${peak}. ${
          empty === 0 ? `No empty hours.` : `${empty} hours produced no ${noun}.`
        } Every hour's figure is in the table that follows.`}
      >
        {series.map((s, i) => {
          const v = s[measure];
          const h = (v / peak) * height;
          const x = i * (barWidth + gap);
          return v === 0 ? (
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
            />
          );
        })}
      </svg>
      <p className="mt-1 flex justify-between text-[11px] text-text-3">
        <span>{formatTimestamp(series[0]!.hour)}</span>
        <span>{formatTimestamp(series[series.length - 1]!.hour)}</span>
      </p>
    </>
  );
}

function ProductionChart({ series }: { series: MetricsResponse["series"] }) {
  if (series.length === 0) {
    return (
      <p className="px-4 py-6 text-center mg-caption text-text-3">
        No production history in this window.
      </p>
    );
  }

  return (
    <figure className="px-4 pt-3 pb-2">
      <ViewToggle
        label="Chart measure"
        param="chart"
        views={[
          { id: "blocks", label: "Blocks", content: <Bars series={series} measure="blocks" /> },
          {
            id: "transactions",
            label: "Transactions",
            content: <Bars series={series} measure="transactions" />,
          },
        ]}
      />
      {/* The wrapper carries `sr-only`, not the table. A table box takes its
          min-content width whatever width is set on it, so `sr-only` on the
          table itself left a 359px element on a 320px page. */}
      <div className="sr-only">
        <table>
          <caption>Blocks and transactions per hour</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">Blocks</th>
              <th scope="col">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.hour}>
                <th scope="row">{formatTimestamp(s.hour)}</th>
                <td>{s.blocks}</td>
                <td>{s.transactions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
          <li key={c.status} className="flex items-center gap-1.5 mg-micro">
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
    <span className="mg-caption text-text-3">
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
        subtitle="How the network is performing right now, measured from the node's records"
        actions={<AllTime blocks={totalBlocks} txs={totalTxs} />}
        className="mb-4"
      >
        {/* The same grammar as the healthy case. A panel that answers when
            things are fine and goes blank when they are not teaches a reader
            that silence means trouble, which is a worse signal than saying so. */}
        <Verdict health={networkHealth(null)} />
        <p className="px-4 py-3 mg-caption text-text-3">
          Everything else on this page is unaffected.
        </p>
      </Panel>
    );
  }

  const { window: w, tip, throughput, admission, finality } = metrics;
  const tipState = tipTone(tip.ageSeconds, throughput.blockIntervalSeconds.p50);
  const backlogTone =
    finality.pending === 0 ? "success" : finality.pending > 50 ? "warning" : "neutral";
  // Nothing happened in the window at all. Distinct from "a slow window":
  // both counts must be zero before a tile is allowed to show all-time data
  // in a window-scoped panel.
  const idle = throughput.blocks === 0 && throughput.transactions === 0;

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
      <Verdict health={networkHealth(metrics)} />

      <div
        data-region="metrics"
        className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5"
      >
        <Figure
          label="Chain tip"
          live={tip.height}
          value={tip.height === null ? "None" : `#${groupThousands(String(tip.height))}`}
          sub={
            tip.ageSeconds === null ? "No blocks" : `${formatDuration(tip.ageSeconds * 1000)} ago`
          }
          tone={tipState.tone}
          term="chainTip"
          hint={`${tipState.note} · ${tip.source}`}
        />
        {/* A quiet window used to spend both of these tiles on a zero while the
            only real figures sat in a caption in the panel's corner. On a node
            that has been idle for days that is every tile reading nothing, and
            a reader concludes the explorer is broken rather than that the node
            is asleep. When the window is empty the tiles fall back to the
            all-time count, and the label says so: a figure whose basis a
            reader cannot see is worth less than the zero it replaced. */}
        <Figure
          label="Blocks"
          term="blockThroughput"
          live={throughput.blocks}
          value={groupThousands(
            String(idle && totalBlocks !== null ? totalBlocks : throughput.blocks),
          )}
          sub={
            idle && totalBlocks !== null
              ? `all time · none in the last ${w.hours}h`
              : throughput.blockIntervalSeconds.p50 === null
                ? "Interval not measured"
                : `every ${Math.round(throughput.blockIntervalSeconds.p50)}s (p50)`
          }
          hint={throughput.source}
        />
        <Figure
          label="Transactions"
          term="transactionThroughput"
          live={throughput.transactions}
          value={groupThousands(
            String(idle && totalTxs !== null ? totalTxs : throughput.transactions),
          )}
          sub={
            idle && totalTxs !== null
              ? `all time · none in the last ${w.hours}h`
              : throughput.transactionsPerBlock === null
                ? "No blocks in window"
                : `${throughput.transactionsPerBlock.toFixed(1)} per block`
          }
          hint={throughput.source}
        />
        <Latency label="Admission" term="admissionLatency" p={admission.latency} />
        <Latency
          label="L1 settlement"
          term="l1Finality"
          p={finality.settlementLatency}
          // Settlement durations are all-time, not windowed, and a block whose
          // reported settlement precedes its own end contributes nothing. Say
          // that, rather than denying the settled count beside it.
          emptyNote={
            finality.finalized > 0
              ? `${finality.finalized} settled, none reported a usable duration`
              : "Nothing settled yet"
          }
        />
      </div>

      <div className="grid divide-y divide-border border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <ProductionChart series={metrics.series} />

        <div>
          <div className="grid grid-cols-2 divide-x divide-border">
            <Figure
              label="Awaiting L1"
              term="l1Finality"
              value={groupThousands(String(finality.pending))}
              sub={`${finality.finalized} settled · ${finality.abandoned} abandoned`}
              tone={backlogTone}
              hint={finality.source}
            />
            <Figure
              label="Admission queue"
              term="admissionQueue"
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
              <p className="mt-1 flex flex-wrap items-center gap-2 mg-caption">
                <Link
                  href={`/block/${finality.oldestUnsettled.headerHash}`}
                  className="inline-flex items-center gap-1 font-medium text-link hover:text-link-hover hover:underline"
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
        <summary className="cursor-pointer px-4 py-2.5 mg-caption font-medium text-text-2 hover:text-text">
          Status breakdown and where each figure comes from
        </summary>
        <div className="border-t border-border">
          <h3 className="px-4 pt-3 mg-overline">Block finalization</h3>
          <StatusBar counts={metrics.statusBreakdown.finalization} />
          <h3 className="border-t border-border px-4 pt-3 mg-overline">
            Transaction admission ({w.hours}h)
          </h3>
          <StatusBar counts={metrics.statusBreakdown.admission} />
          <dl className="border-t border-border px-4 py-3 mg-micro">
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
          <p className="border-t border-border px-4 py-2.5 mg-micro leading-relaxed text-text-3">
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
