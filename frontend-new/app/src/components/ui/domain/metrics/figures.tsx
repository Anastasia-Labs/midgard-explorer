import type { MetricsResponse, Percentile } from "@midgard-explorer/contracts";
import Link from "next/link";
import { cn, formatDuration, formatTimestamp, groupThousands } from "../../../../lib/format";
import type { NetworkHealth } from "../../../../lib/health";
import type { GlossaryTerm } from "../../../../lib/glossary";
import { Icon } from "../../base/icons";
import { FieldLabel } from "../../base/infotip";
import { LiveValue } from "../../base/livevalue";
import { StatusBadge } from "../../domain/status";
import { ProductionChart, StatusBar } from "./charts";
import { THIN_SAMPLE, VERDICT_TONE, tipTone } from "./model";

/**
 * One reading each, in the grammar every record page uses.
 *
 * Each figure carries the sample it was measured over, the window it covers and
 * the node column it came from. A dashboard that shows a p95 across four
 * records as though it were a measurement is confidently wrong, and an operator
 * who discovers that once will never trust the panel again.
 */

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
export function Verdict({ health }: { health: NetworkHealth }) {
  const tone = VERDICT_TONE[health.state];
  return (
    <div
      data-region="verdict"
      data-verdict-state={health.state}
      className="border-b border-border px-4 py-3.5"
    >
      <p className="flex items-start gap-2.5">
        <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full", tone.dot)} />
        {/* Larger than the 19px figures at every width, including the phone.
            An earlier version was 19px at base and only outgrew them at `sm`,
            which left the panel with no focal point on exactly the viewport
            where having one matters most. */}
        <span
          className={cn(
            /* Stays ahead of the figures below it at both breakpoints. The
               conclusion is what a reader should take from this panel; the
               figures are the evidence for it, and evidence does not outrank
               the finding. Asserted in test/components.test.tsx and again in
               e2e/populated.spec.ts, which measures both and compares them.

               The last two arbitrary sizes in the app, and they are here on
               purpose. Tailwind has no step between 2xl (24) and 3xl (30), and
               `Figure` below is 24. Naming this pair `text-2xl sm:text-3xl`
               would tie the headline with the figures at base width and fail
               that comparison; dropping `Figure` to `text-xl` would put it at
               20px, which is the size its own comment records as too small to
               be a focal point. Flattening this to `text-3xl` would hold the
               invariant, but the headlines are sentences ("The network's
               health cannot be judged right now.") and 30px costs two extra
               lines on a phone.

               So the third tier is real here, and 26 is the number that makes
               it work. `scripts/type-scale-check.mjs` carries a baseline of 2
               to hold exactly this, rather than 0 with an exception nobody
               can see. */
            "text-[26px] leading-snug font-semibold text-balance sm:text-[30px]",
            tone.text,
          )}
        >
          {health.headline}
        </span>
      </p>
      {health.reasons.length > 0 ? (
        /* Severity decides density. A healthy verdict's reasons restate the
           interval and the pending count, both of which are tiles a thumb
           away, so a phone drops them and keeps the sentence. Every other
           state's reasons are the only place its evidence appears, and a
           stopped chain is the one thing a reader must not have to scroll
           for. */
        <ul
          data-region="verdict-reasons"
          data-density={health.state === "healthy" ? "collapsible" : "always"}
          className={cn("mt-2 space-y-1 pl-4.5", health.state === "healthy" && "max-sm:hidden")}
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
        /* The dashboard's primary read. At 19px these sat at the same weight
           as the labels and the sub-lines around them, so the page had no
           first fixation and every panel competed equally. */
        "text-2xl font-semibold leading-tight tracking-tight tabular-nums",
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
export function Latency({
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

/** The degraded branch only. When metrics are available the Blocks and
 * Transactions figures already carry these totals, so rendering them here as
 * well would state the same number twice in one panel. When metrics fail there
 * are no figures to carry them, and the panel would otherwise say nothing about
 * how big the chain is. */
export function AllTime({ blocks, txs }: { blocks: number | null; txs: number | null }) {
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

/** The four figures a reader arrives asking about: where the chain is, how big
 * it is, and how much is still waiting on Cardano. Split out of the panel body
 * only so the panel's two branches (metrics present, metrics null) don't have
 * to repeat the JSX; there is exactly one caller. */
export function CoreFigures({
  metrics,
  totalBlocks,
  totalTxs,
}: {
  metrics: MetricsResponse;
  totalBlocks: number | null;
  totalTxs: number | null;
}) {
  const { window: w, tip, throughput, finality } = metrics;
  const tipState = tipTone(tip.ageSeconds, throughput.blockIntervalSeconds.p50);
  const backlogTone =
    finality.pending === 0 ? "success" : finality.pending > 50 ? "warning" : "neutral";
  return (
    <div
      data-region="metrics"
      className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4"
    >
      <Figure
        label="Chain tip"
        live={tip.headerHash}
        value={
          tip.headerHash === null
            ? "None"
            : tip.height === null
              ? `${tip.headerHash.slice(0, 8)}…`
              : `#${groupThousands(String(tip.height))}`
        }
        sub={tip.ageSeconds === null ? "No blocks" : `${formatDuration(tip.ageSeconds * 1000)} ago`}
        tone={tipState.tone}
        term="chainTip"
        // The cadence note, not the node column. Where the figure came from is
        // listed once, on the health page.
        hint={tipState.note}
      />
      {/* These values use the same canonical all-time totals as the list
          pages. Window activity remains useful context, but must not occupy
          the primary value and appear to contradict the list total. */}
      <Figure
        label="Blocks"
        term="blockThroughput"
        live={totalBlocks ?? throughput.blocks}
        value={groupThousands(String(totalBlocks ?? throughput.blocks))}
        sub={
          totalBlocks === null
            ? `${throughput.blocks} in the last ${w.hours}h · total unavailable`
            : `${throughput.blocks} in the last ${w.hours}h · all time total`
        }
      />
      <Figure
        label="Transactions"
        term="transactionThroughput"
        live={totalTxs ?? throughput.transactions}
        value={groupThousands(String(totalTxs ?? throughput.transactions))}
        sub={
          totalTxs === null
            ? `${throughput.transactions} in the last ${w.hours}h · total unavailable`
            : `${throughput.transactions} in the last ${w.hours}h · all time total`
        }
      />
      <Figure
        label="Awaiting settlement"
        term="l1Finality"
        value={groupThousands(String(finality.pending))}
        sub={`${finality.finalized} settled · ${finality.abandoned} abandoned`}
        tone={backlogTone}
      />
    </div>
  );
}
