import { cn } from "../../../lib/format";
import { statusOf, type StatusTone } from "../../../lib/status-registry";
import type { IconName } from "../base/icons";
import { InfoTip } from "../base/infotip";
import { L1L2Badge } from "../base/layout";

export { statusOf };

/** State class drives shape and weight; tone drives hue. Encoding state in
 * both means terminal and pending states stay separable at a glance and
 * survive monochrome or color-blind viewing, which hue alone does not. */
type StateClass = "settled" | "progressing" | "waiting" | "failed" | "unknown";

const STATE_CLASS: Record<StatusTone, StateClass> = {
  success: "settled",
  info: "progressing",
  warning: "waiting",
  danger: "failed",
  neutral: "waiting",
};

const TONE_CLASS: Record<StatusTone, string> = {
  // Settled and failed states are filled: they are conclusions, and they should
  // carry more weight than the states still in motion.
  success: "bg-success/12 text-success font-semibold",
  danger: "bg-danger/12 text-danger font-semibold",
  info: "bg-info/10 text-info font-medium",
  warning: "bg-warning/12 text-warning font-medium",
  neutral: "bg-surface-2 text-text-2 font-medium",
};

/** Shape of the leading marker, so the badge reads without color. */
const TEXT_CLASS: Record<StatusTone, string> = {
  success: "text-success font-semibold",
  danger: "text-danger font-semibold",
  info: "text-info font-medium",
  warning: "text-warning font-medium",
  neutral: "text-text-2 font-medium",
};

function Marker({ state }: { state: StateClass }) {
  if (state === "settled") {
    return (
      <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 fill-none stroke-current">
        <path d="M2.5 6.3l2.4 2.4 4.6-5" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === "failed") {
    return (
      <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 fill-none stroke-current">
        <path d="M3 3l6 6M9 3l-6 6" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === "progressing") {
    return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />;
  }
  // Waiting and unknown read as an outline: nothing has concluded yet.
  return (
    <span
      aria-hidden
      className="size-1.5 shrink-0 rounded-full border border-current bg-transparent"
    />
  );
}

/** The badge itself, given a resolved answer.
 *
 * Separated from `StatusBadge` because not every state a page states comes from
 * a status code. A transaction's authoritative lifecycle answer is the journey
 * model's, which resolves the node's code together with inclusion and Cardano
 * finality; rendering the raw code beside it produced two badges disagreeing
 * about one transaction. */
export function ToneBadge({
  tone,
  label,
  explain,
  recognized = true,
  className,
  variant = "pill",
}: {
  tone: StatusTone;
  label: string;
  explain?: string | undefined;
  recognized?: boolean | undefined;
  className?: string | undefined;
  /** `text` for table rows: the colour and the mark without the pill, so a
   * column of statuses reads as text rather than a stack of buttons. */
  variant?: "pill" | "text";
}) {
  const state: StateClass = recognized ? STATE_CLASS[tone] : "unknown";
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span
        className={cn(
          // Status codes arrive from the node and are not a closed set, so one
          // can be arbitrarily long and carry no spaces to break on. Without
          // this an unrecognised code widens its row, and at 320px that pushes
          // the whole page into a horizontal scroll.
          "inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs",
          variant === "pill" ? "rounded-full px-2 py-0.5" : null,
          // Registry labels are short product copy. Breaking "Projected" into
          // a column of letters made a valid desktop row look corrupted. Node
          // status codes are an open set, though, and an unknown unbroken code
          // must still break instead of widening the page. The registry
          // boundary is the one place that knows which rule is safe.
          //
          // Normal wrapping, not `whitespace-nowrap`: a recognized label may be
          // several words ("Pending submission"), and forbidding every break
          // put 61px of horizontal scroll on the overview at 320px. Normal
          // breaks at spaces and never inside a word, which is all "Projected"
          // needed.
          recognized ? null : "wrap-anywhere",
          variant === "pill" ? TONE_CLASS[tone] : TEXT_CLASS[tone],
          className,
        )}
      >
        <Marker state={state} />
        {label}
        {recognized ? null : <span className="sr-only">(unrecognized status)</span>}
      </span>
      {explain ? <InfoTip explain={explain} subject={label} /> : null}
    </span>
  );
}

export function StatusBadge({
  status,
  className,
  explain = true,
  variant = "pill",
}: {
  status: string;
  className?: string;
  /** Off in list cells: one explanation per record page, not one per row. */
  explain?: boolean;
  variant?: "pill" | "text";
}) {
  const entry = statusOf(status);
  return (
    <ToneBadge
      tone={entry.tone}
      label={entry.label}
      explain={explain ? entry.explain : undefined}
      recognized={entry.known}
      className={className}
      variant={variant}
    />
  );
}

/** A status in a list row: coloured text and its mark, no pill. The
 * explanation lives on the record's page and in the Status key. */
export function StatusCell({ status }: { status: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center">
      <StatusBadge status={status} explain={false} variant="text" className="min-w-0" />
    </span>
  );
}

const MARK_ICON: Record<StateClass, IconName> = {
  settled: "circleCheck",
  progressing: "circleDot",
  waiting: "circleEllipsis",
  failed: "circleX",
  unknown: "circleHelp",
};

const MARK_COLOR: Record<StatusTone, string> = {
  success: "text-success",
  danger: "text-danger",
  info: "text-info",
  warning: "text-warning",
  neutral: "text-text-3",
};

/** A status as its mark alone, where space is tight, as on the overview's
 * latest lists. The circled glyph carries the state class and the color the
 * tone; the name is in the tooltip, on hover, focus or tap, and is the
 * mark's accessible name. */
export function StatusMark({ status }: { status: string }) {
  const entry = statusOf(status);
  const state: StateClass = entry.known ? STATE_CLASS[entry.tone] : "unknown";
  const name = entry.label;
  return (
    <InfoTip
      explain={name}
      triggerLabel={name}
      icon={MARK_ICON[state]}
      iconSize={16}
      triggerClassName={MARK_COLOR[entry.known ? entry.tone : "neutral"]}
    />
  );
}

/** Where a record is on Midgard, and whether its block has settled on
 * Cardano. Two facts, shown together so one is never read as the other. */
export function StatusPair({ l2, l1 }: { l2: string; l1: string | null }) {
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <StatusCell status={l2} />
      <span className="inline-flex items-center gap-1">
        <L1L2Badge layer="L1" />
        {l1 === null ? (
          <span className="text-xs text-text-3">Not recorded</span>
        ) : (
          <StatusCell status={l1} />
        )}
      </span>
    </span>
  );
}
