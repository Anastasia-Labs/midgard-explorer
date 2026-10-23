import { cn } from "../../lib/format";
import { statusOf, type StatusTone } from "../../lib/status-registry";
import { InfoTip } from "./infotip";
import { JourneyIndicator } from "./journey";

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
  success: "border-success/40 bg-success/15 text-success font-semibold",
  danger: "border-danger/50 bg-danger/15 text-danger font-semibold",
  info: "border-info/40 bg-info/10 text-info font-medium",
  warning: "border-warning/45 bg-warning/10 text-warning font-medium",
  neutral: "border-border-strong border-dashed bg-transparent text-text-2 font-medium",
};

/** Shape of the leading marker, so the badge reads without color. */
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
}: {
  tone: StatusTone;
  label: string;
  explain?: string | undefined;
  recognized?: boolean | undefined;
  className?: string | undefined;
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
          "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
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
          TONE_CLASS[tone],
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

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { tone, label, explain, known } = statusOf(status);
  return (
    <ToneBadge
      tone={tone}
      label={label}
      explain={explain}
      recognized={known}
      className={className}
    />
  );
}

/** The list-row form: what state, and how far through the protocol that state
 * is. The badge alone leaves a reader ranking codes from memory. */
export function StatusCell({ status }: { status: string }) {
  return (
    /* `min-w-0 max-w-full` for the same reason the badge itself carries them:
       without it this wrapper keeps its content width under a `min-w-0` parent,
       so "Pending submission" beside the indicator pushed the overview 18px
       past a 320px viewport. The indicator does not shrink, so the badge text
       is what gives way. */
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <StatusBadge status={status} className="min-w-0" />
      <JourneyIndicator status={status} />
    </span>
  );
}
