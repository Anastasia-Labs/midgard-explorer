import Link from "next/link";
import { railStages, type JourneyModel, type JourneyStage, type JourneyStageState } from "../../lib/journey";
import { cn, formatTimestamp } from "../../lib/format";
import { Icon } from "./icons";
import { L1TxLink } from "./l1link";

/** One visual grammar for every path through the protocol.
 *
 * Replaces three stacked sections (lifecycle chips, admission timeline,
 * settlement band) that each retold the same story from a different angle and
 * cost 598px on a 390px phone. The current state and the finality answer stay
 * above the fold; per-stage timestamps and node metadata move behind a
 * disclosure, because they are evidence, not the answer.
 *
 * The rail is the product's signature: nodes fill as stages are reached, the
 * connector breaks at a failure, and an unrecognized stage appears as itself. */

const NODE: Record<JourneyStageState, string> = {
  reached: "border-success bg-success",
  current: "border-info bg-info ring-3 ring-info/20",
  future: "border-border-strong bg-transparent",
  failed: "border-danger bg-danger",
  unknown: "border-warning border-dashed bg-transparent",
};

const LABEL: Record<JourneyStageState, string> = {
  reached: "text-text",
  current: "text-info font-semibold",
  future: "text-text-3",
  failed: "text-danger font-semibold",
  unknown: "text-warning font-medium",
};

const OUTCOME_TONE = {
  complete: "text-success",
  active: "text-info",
  failed: "text-danger",
  unknown: "text-warning",
} as const;

function Connector({ broken }: { broken: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-px w-4 shrink-0 sm:w-8",
        broken ? "border-t border-dashed border-danger/60" : "bg-border-strong",
      )}
    />
  );
}

function StageNode({ stage }: { stage: JourneyStage }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span aria-hidden className={cn("size-2.5 rounded-full border-2", NODE[stage.state])} />
      <span className={cn("whitespace-nowrap text-[12.5px]", LABEL[stage.state])}>
        {stage.label}
      </span>
    </span>
  );
}

/** Absence has kinds, and saying which one is the difference between honest and
 * empty: not recorded is a gap in the data, not applicable is a stage that
 * cannot happen yet. */
function stageTime(stage: JourneyStage): string {
  if (stage.timestampKind === "recorded" && stage.occurredAt !== null) {
    return formatTimestamp(stage.occurredAt);
  }
  return stage.timestampKind === "not_applicable" ? "Not applicable yet" : "Not recorded";
}

export function Journey({
  model,
  detailsLabel = "Stage timings and evidence",
  children,
}: {
  model: JourneyModel;
  detailsLabel?: string;
  children?: React.ReactNode;
}) {
  const rail = railStages(model.stages);
  const failedAt = rail.findIndex((s) => s.state === "failed");

  return (
    <section
      data-region="journey"
      aria-label="Protocol journey"
      className="mb-4 overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)"
    >
      <div className="px-4 pt-3">
        <h2 className={cn("font-display text-[15px] font-semibold", OUTCOME_TONE[model.outcome])}>
          {model.headline}
        </h2>
      </div>

      {/* The rail scrolls rather than wrapping: a wrapped rail reads as two
          journeys. `-mx-4 px-4` keeps the scroll edge flush with the card.
          A scrollable region needs its own tab stop, or keyboard users cannot
          reach the stages that overflow. */}
      <ol
        tabIndex={0}
        aria-label={`Stages: ${rail.map((s) => s.label).join(", ")}`}
        className="mt-2 -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 sm:mx-0 sm:px-4"
      >
        {rail.map((s, i) => (
          <li key={s.key} className="flex shrink-0 items-center gap-2">
            {i > 0 ? <Connector broken={failedAt !== -1 && i === failedAt} /> : null}
            <StageNode stage={s} />
          </li>
        ))}
      </ol>

      <p className="px-4 pt-1.5 pb-3 text-[12.5px] leading-relaxed text-text-2">
        {model.explanation}
      </p>

      <details className="border-t border-border">
        <summary className="cursor-pointer px-4 py-2 text-[12.5px] font-medium text-text-2 hover:text-text">
          {detailsLabel}
        </summary>
        <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
          {model.stages.map((s) => (
            <div key={s.key} className="bg-surface px-4 py-2.5">
              <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-text">
                <span aria-hidden className={cn("size-2 rounded-full border-2", NODE[s.state])} />
                {s.label}
              </dt>
              <dd className="mt-0.5 font-mono text-[12px] text-text-3">{stageTime(s)}</dd>
              {s.evidence?.blockHeight !== undefined && s.evidence.blockHash ? (
                <dd className="mt-1 text-[12px]">
                  <Link
                    href={`/block/${s.evidence.blockHash}`}
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    Block #{s.evidence.blockHeight}
                    <Icon name="arrowRight" size={11} />
                  </Link>
                </dd>
              ) : null}
              {s.evidence?.l1TxHash ? (
                <dd className="mt-1 text-[12px]">
                  L1 tx: <L1TxLink hash={s.evidence.l1TxHash} />
                </dd>
              ) : null}
              <dd className="mt-1 font-mono text-[11px] text-text-3">source: {s.source}</dd>
            </div>
          ))}
        </dl>
        {children ? <div className="border-t border-border px-4 py-2.5">{children}</div> : null}
      </details>
    </section>
  );
}
