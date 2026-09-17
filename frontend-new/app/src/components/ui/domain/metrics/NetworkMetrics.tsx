import type { MetricsResponse } from "@midgard-explorer/contracts";
import Link from "next/link";
import { formatDuration, formatTimestamp, groupThousands } from "../../../../lib/format";
import { networkHealth } from "../../../../lib/health";
import { Icon } from "../../base/icons";
import { StatusBadge } from "../../domain/status";
import { ProductionChart } from "./charts";
import { Card, Panel } from "../../base/layout";
import { AllTime, CoreFigures, Figure, Verdict } from "./figures";

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
      <>
        <Panel
          title="Network activity"
          subtitle="Activity recorded by the connected node"
          actions={<AllTime blocks={totalBlocks} txs={totalTxs} />}
          className="mb-4"
        >
          {/* The same grammar as the healthy case. A panel that answers when
            things are fine and goes blank when they are not teaches a reader
            that silence means trouble, which is a worse signal than saying so. */}
          <Verdict health={networkHealth(null)} />
          <p className="px-4 py-3 mg-caption text-text-3">Other sections may still be available.</p>
        </Panel>
      </>
    );
  }

  const { window: w, admission, finality } = metrics;
  return (
    <>
      <Panel
        title="Network activity"
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
      </Panel>
      <Card className="mb-4">
        <div className="grid divide-y divide-border lg:grid-cols-[2fr_1fr] lg:divide-x lg:divide-y-0">
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
      </Card>
    </>
  );
}
