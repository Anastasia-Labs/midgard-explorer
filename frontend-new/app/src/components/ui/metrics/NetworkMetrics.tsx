import type { MetricsResponse } from "@midgard-explorer/contracts";
import Link from "next/link";
import { formatDuration, formatTimestamp, groupThousands } from "../../../lib/format";
import { networkHealth } from "../../../lib/health";
import { Icon } from "../icons";
import { StatusBadge } from "../status";
import { ProductionChart, StatusBar } from "./charts";
import { THIN_SAMPLE } from "./model";
import { Panel } from "../primitives";
import { AllTime, CoreFigures, Figure, Latency, Verdict } from "./figures";

/**
 * The operations panel, composed.
 *
 * It states its conclusion first and shows its working underneath. Five figures
 * at equal weight left the reader to decide whether 43s of settlement latency
 * and a 33% abandonment rate add up to a working chain, which is precisely the
 * judgement someone arriving at an explorer has no basis to make.
 */

export function NetworkMetrics({
  metrics,
  totalBlocks,
  totalTxs,
  freshness,
}: {
  metrics: MetricsResponse | null;
  totalBlocks: number | null;
  totalTxs: number | null;
  /** How recently these figures were fetched. It belongs to this panel rather
   * than to the page title: it qualifies these numbers and nothing else. */
  freshness?: React.ReactNode;
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
      actions={freshness}
      className="mb-4"
    >
      <Verdict health={networkHealth(metrics)} />

      <CoreFigures metrics={metrics} totalBlocks={totalBlocks} totalTxs={totalTxs} />

      <div className="grid divide-y divide-border border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <ProductionChart series={metrics.series} />

        <div>
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
          />

          {finality.oldestUnsettled ? (
            <div className="border-t border-border px-4 py-3">
              <p className="mg-overline">Oldest block awaiting settlement</p>
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
          Latency, status breakdown and where each figure comes from
        </summary>
        <div className="border-t border-border">
          {/* Distributions rather than current state. A reader who wants to
              know how fast the chain usually is has asked a deeper question
              than one who wants to know whether it is moving, and the panel
              above answers the shallower one first. */}
          <h3 className="px-4 pt-3 mg-overline">Latency</h3>
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <Latency label="Admission" term="admissionLatency" p={admission.latency} />
            <Latency
              // "L1 settlement" read as a status, so "No data" looked like
              // nothing had settled while the sub-line said nine had. This is
              // a duration.
              label="Cardano settlement time"
              term="l1Finality"
              p={finality.settlementLatency}
              // Settlement durations are all-time, not windowed, and a block
              // whose reported settlement precedes its own end contributes
              // nothing. Say that, rather than denying the settled count
              // beside it.
              emptyNote={
                finality.finalized > 0
                  ? `${finality.finalized} settled, none reported a usable duration`
                  : "Nothing settled yet"
              }
            />
          </div>
          <h3 className="border-t border-border px-4 pt-3 mg-overline">Block finalization</h3>
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
