import { cn } from "../../lib/format";

const HAPPY_PATH = ["queued", "validating", "accepted", "pending_commit", "committed"] as const;

type HappyStep = (typeof HAPPY_PATH)[number];

const LABELS: Record<HappyStep, string> = {
  queued: "Queued",
  validating: "Validating",
  accepted: "Accepted",
  pending_commit: "Pending commit",
  committed: "Committed",
};

/** Steps scroll horizontally on narrow viewports instead of wrapping arrows
 * onto their own line. A scrollable region must be keyboard-reachable, hence
 * `tabIndex={0}` on the list (axe: scrollable-region-focusable). */
const STEPPER_CLASS =
  "-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0";

export function LifecycleStepper({ status }: { status: string }) {
  if (status === "rejected") {
    return (
      <ol tabIndex={0} className={STEPPER_CLASS} aria-label="Transaction lifecycle">
        <li className="flex shrink-0 items-center gap-2">
          <Step label="Queued" state="done" />
        </li>
        <li className="flex shrink-0 items-center gap-2">
          <Arrow />
          <Step label="Validating" state="done" />
        </li>
        <li className="flex shrink-0 items-center gap-2">
          <Arrow />
          <Step label="Rejected" state="failed" />
        </li>
      </ol>
    );
  }

  const idx = (HAPPY_PATH as readonly string[]).indexOf(status);
  if (idx === -1) return null;

  return (
    <ol tabIndex={0} className={STEPPER_CLASS} aria-label="Transaction lifecycle">
      {HAPPY_PATH.map((step, i) => (
        <li key={step} className="flex shrink-0 items-center gap-2">
          {i > 0 ? <Arrow /> : null}
          <Step
            label={LABELS[step]}
            state={
              // "committed" is terminal: it reads as reached, not in-progress.
              i < idx || (i === idx && idx === HAPPY_PATH.length - 1)
                ? "done"
                : i === idx
                  ? "current"
                  : "todo"
            }
          />
        </li>
      ))}
    </ol>
  );
}

type StepState = "done" | "current" | "todo" | "failed";

function Step({ label, state }: { label: string; state: StepState }) {
  return (
    <span
      aria-current={state === "current" ? "step" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        state === "done" && "border-success/30 bg-success/10 text-success",
        state === "current" && "border-info/40 bg-info/10 font-medium text-info",
        state === "todo" && "border-border text-text-3",
        state === "failed" && "border-danger/40 bg-danger/10 font-medium text-danger",
      )}
    >
      {state === "current" ? (
        <span aria-hidden className="mg-pulse size-1.5 rounded-full bg-current" />
      ) : null}
      {label}
    </span>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="text-text-3">
      →
    </span>
  );
}
