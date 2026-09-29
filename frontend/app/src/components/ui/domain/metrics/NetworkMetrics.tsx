import type { MetricsResponse } from "@midgard-explorer/contracts";
import Link from "next/link";
import { formatDuration, formatTimestamp, groupThousands } from "../../../../lib/format";
import { networkHealth } from "../../../../lib/health";
import { Icon } from "../../base/icons";
import { Panel, RetryButton } from "../../base/layout";
import { CoreFigures, Verdict } from "./figures";

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
  onRetry,
}: {
  metrics: MetricsResponse | null;
  totalBlocks: number | null;
  totalTxs: number | null;
  /** How recently these figures were fetched. It belongs to this panel rather
   * than to the page title: it qualifies these numbers and nothing else. */
  freshness?: React.ReactNode;
  /** Offered in place of the freshness note when the figures did not arrive. */
  onRetry?: () => void;
}) {
  // One layout whether or not the figures arrived. When they did not, every
  // tile keeps its place with its default value, so a failure reads as
  // missing numbers rather than a panel that vanished.
  const w = metrics?.window ?? null;
  const finality = metrics?.finality ?? null;
  return (
    <>
      <Panel
        title="Network activity"
        // Said only when the node holds less history than the chart's window,
        // because then the chart's first hours were never observed.
        subtitle={w?.partial ? `Since ${formatTimestamp(w.observedFrom ?? w.start)}` : undefined}
        actions={
          <span className="flex items-center gap-3">
            {metrics === null && onRetry ? <RetryButton onRetry={onRetry} /> : freshness}
            <Link
              href="/health"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-link transition-colors hover:bg-surface-2 hover:text-link-hover"
            >
              Details
              <Icon name="arrowRight" size={14} />
            </Link>
          </span>
        }
        className="mb-4"
      >
        <Verdict health={networkHealth(metrics)} />

        <CoreFigures metrics={metrics} totalBlocks={totalBlocks} totalTxs={totalTxs} />

        {/* Settlement is an operator's figure, so it stays off the overview
            until a block is waiting, and then says only how many and how long. */}
        {finality !== null && finality.pending > 0 ? (
          <p
            data-region="settlement-notice"
            className="border-t border-border px-4 py-2.5 text-center mg-caption text-text-2"
          >
            {`${groupThousands(String(finality.pending))} ${finality.pending === 1 ? "block" : "blocks"} awaiting settlement`}
            {finality.oldestUnsettled === null
              ? null
              : ` · ${finality.pending > 1 ? "oldest " : ""}${formatDuration(
                  finality.oldestUnsettled.waitingSeconds * 1000,
                )}`}
          </p>
        ) : null}
      </Panel>
    </>
  );
}
