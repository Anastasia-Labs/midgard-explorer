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

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { tone, label, explain, known } = statusOf(status);
  const state: StateClass = known ? STATE_CLASS[tone] : "unknown";
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
          TONE_CLASS[tone],
          className,
        )}
      >
        <Marker state={state} />
        {label}
        {known ? null : <span className="sr-only">(unrecognized status)</span>}
      </span>
      <InfoTip explain={explain} subject={label} />
    </span>
  );
}

/** The list-row form: what state, and how far through the protocol that state
 * is. The badge alone leaves a reader ranking codes from memory. */
export function StatusCell({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusBadge status={status} />
      <JourneyIndicator status={status} />
    </span>
  );
}
