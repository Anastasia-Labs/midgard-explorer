import type { MetricsResponse } from "@midgard-explorer/contracts";
import { cn, formatDuration, groupThousands } from "../../../../lib/format";
import { ShortId } from "../identifier";
import type { NetworkHealth } from "../../../../lib/health";
import type { GlossaryTerm } from "../../../../lib/glossary";
import { FieldLabel } from "../../base/infotip";
import { LiveValue } from "../../base/livevalue";
import { VERDICT_TONE, tipTone } from "./model";

/**
 * One reading each, in the grammar every record page uses.
 *
 * Each figure carries the sample it was measured over, the window it covers and
 * the node column it came from. A dashboard that shows a p95 across four
 * records as though it were a measurement is confidently wrong, and an operator
 * who discovers that once will never trust the panel again.
 */

/** Compact activity notice. Supporting evidence stays visible for problems. */
export function Verdict({ health }: { health: NetworkHealth }) {
  const tone = VERDICT_TONE[health.state];
  return (
    <div
      data-region="verdict"
      data-verdict-state={health.state}
      className="border-b border-border bg-surface-2 px-4 py-3"
    >
      <p className="flex items-start gap-2.5 text-sm leading-6">
        <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full", tone.dot)} />
        <span className="font-medium text-text">{health.headline}</span>
      </p>
      {health.reasons.length > 0 ? (
        <ul
          data-region="verdict-reasons"
          data-density={health.state === "healthy" ? "collapsible" : "always"}
          className={cn("mt-1 space-y-1 pl-4.5", health.state === "healthy" && "max-sm:hidden")}
        >
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

export function Figure({
  label,
  value,
  sub,
  tone = "neutral",
  hint,
  term,
  live,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** `unknown` for a default standing in for a value that did not arrive:
   * muted, so it does not read as a measurement. */
  tone?: "neutral" | "success" | "warning" | "danger" | "unknown";
  hint?: string;
  term?: GlossaryTerm | undefined;
  /** Comparable identity of the figure. Given, the value tints when it moves,
   * which is the only motion on this page that means anything. */
  live?: string | number | null;
  className?: string;
}) {
  const figure = (
    <span
      className={cn(
        /* The dashboard's primary read. At 19px these sat at the same weight
           as the labels and the sub-lines around them, so the page had no
           first fixation and every panel competed equally. */
        "text-2xl font-semibold leading-tight tracking-tight tabular-nums",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-danger",
        tone === "neutral" && "text-text",
        tone === "unknown" && "text-text-3",
      )}
    >
      {value}
      {tone === "unknown" ? <span className="sr-only"> (unavailable)</span> : null}
    </span>
  );
  return (
    // Centred as one unit: label, value and sub-line share one axis, as every
    // figure tile on the overview does.
    <div className={cn("min-w-0 px-4 py-3 text-center", className)}>
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

/** A number that did not arrive. The tile keeps its place and its label and
 * says Unavailable in the muted tone, with no status colour: in this explorer
 * a missing figure is never shown as a zero that looks measured. */
export const DEFAULT_VALUE = "Unavailable";

/** A default standing in for a value that did not arrive: muted on screen and
 * named unavailable for a screen reader, so a missing figure is not told apart
 * from a real one by colour alone. */
export function Missing({ children = DEFAULT_VALUE }: { children?: React.ReactNode }) {
  return (
    <span className="text-text-3">
      {children}
      {children === DEFAULT_VALUE ? null : <span className="sr-only"> (unavailable)</span>}
    </span>
  );
}

/** Below lg the tip takes the card's width so its hash has room, and blocks
 * and transactions share the row beneath it. */
const WIDE_BELOW_LG = "col-span-2 lg:col-span-1";

/** An all-time total, from its own call, so it survives a metrics failure. */
const total = (n: number | null) => (n === null ? DEFAULT_VALUE : groupThousands(String(n)));

/** The three figures a reader arrives asking about: where the chain is and how
 * big it is. Blocks and transactions are all-time totals, the same ones the
 * list pages show; the last 24 hours are in the chart below. Settlement lives
 * in the Cardano panel. With no metrics every tile still renders with its
 * default value. */
export function CoreFigures({
  metrics,
  totalBlocks,
  totalTxs,
}: {
  metrics: MetricsResponse | null;
  totalBlocks: number | null;
  totalTxs: number | null;
}) {
  const tip = metrics?.tip ?? null;
  const tipState = metrics === null ? null : tipTone(metrics);
  return (
    <div
      data-region="metrics"
      className="grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-3"
    >
      <Figure
        label="Chain tip"
        className={WIDE_BELOW_LG}
        term="chainTip"
        {...(tip === null || tipState === null
          ? { value: "None", tone: "unknown" as const }
          : {
              live: tip.headerHash,
              value:
                tip.headerHash === null ? (
                  "None"
                ) : tip.height === null ? (
                  // A block the node no longer numbers is named by its hash, a
                  // size down from the other figures.
                  <span className="whitespace-nowrap font-mono text-lg">
                    <ShortId value={tip.headerHash} head={12} tail={10} />
                  </span>
                ) : (
                  `Block #${groupThousands(String(tip.height))}`
                ),
              sub:
                tip.ageSeconds === null
                  ? "No blocks"
                  : `${formatDuration(tip.ageSeconds * 1000)} ago`,
              tone: tipState,
            })}
      />
      <Figure
        label="Blocks"
        term="blocksTotal"
        live={totalBlocks}
        value={total(totalBlocks)}
        tone={totalBlocks === null ? "unknown" : "neutral"}
      />
      <Figure
        label="Transactions"
        term="transactionsTotal"
        live={totalTxs}
        value={total(totalTxs)}
        tone={totalTxs === null ? "unknown" : "neutral"}
      />
    </div>
  );
}
