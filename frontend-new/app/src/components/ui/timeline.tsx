import type { BlockFinalization, TxAdmission } from "@midgard-explorer/contracts";
import { cn, formatDuration, formatTimestamp } from "../../lib/format";
import { Card } from "./primitives";
import { StatusBadge } from "./status";

type StepState = "done" | "current" | "todo" | "failed";

type TimelineStep = {
  label: string;
  timestamp: string | null;
  detail?: string | undefined;
  state: StepState;
};

function delta(from: string, to: string): string | undefined {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return `+${formatDuration(end - start)}`;
}

function RecordedTimeline({
  label,
  steps,
  footer,
}: {
  label: string;
  steps: TimelineStep[];
  footer?: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <ol
        aria-label={label}
        className="grid overflow-hidden lg:grid-cols-[repeat(var(--timeline-cols),minmax(0,1fr))]"
        style={{ "--timeline-cols": steps.length } as React.CSSProperties}
      >
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={cn(
              "relative min-w-0 border-b border-border px-4 py-3.5 last:border-b-0 lg:border-r lg:border-b-0 lg:last:border-r-0",
              step.state === "current" && "bg-info/5",
              step.state === "failed" && "bg-danger/5",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "relative z-10 size-2.5 shrink-0 rounded-full border-2 bg-surface",
                  step.state === "done" && "border-success bg-success",
                  step.state === "current" && "border-info bg-info ring-2 ring-info/15",
                  step.state === "todo" && "border-border-strong",
                  step.state === "failed" && "border-danger bg-danger",
                )}
              />
              <p
                className={cn(
                  "text-sm font-semibold text-text",
                  step.state === "todo" && "text-text-3",
                  step.state === "failed" && "text-danger",
                )}
              >
                {step.label}
              </p>
            </div>
            <div className="mt-2 pl-[18px]">
              <p className="font-mono text-[12px] text-text-2">
                {step.timestamp ? formatTimestamp(step.timestamp) : "Time not recorded"}
              </p>
              {step.detail ? <p className="mt-0.5 text-[12px] text-text-3">{step.detail}</p> : null}
            </div>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className="absolute top-[18px] right-0 hidden h-px w-4 translate-x-1/2 bg-border-strong lg:block"
              />
            ) : null}
          </li>
        ))}
      </ol>
      {footer ? (
        <div className="border-t border-border px-4 py-2.5 text-[12px] text-text-3">{footer}</div>
      ) : null}
    </Card>
  );
}

export function AdmissionTimeline({
  admission,
  outcome,
}: {
  admission: TxAdmission;
  outcome: string;
}) {
  const rejected = outcome === "rejected" || admission.status === "rejected";
  const validationStarted = admission.validationStartedAt;
  const terminal = admission.terminalAt;
  const steps: TimelineStep[] = [
    {
      label: "First seen",
      timestamp: admission.firstSeenAt,
      detail: "Queued by the node",
      state: "done",
    },
    {
      label: "Validation started",
      timestamp: validationStarted,
      detail: validationStarted ? delta(admission.firstSeenAt, validationStarted) : undefined,
      state:
        validationStarted !== null
          ? admission.status === "validating"
            ? "current"
            : "done"
          : admission.status === "queued"
            ? "todo"
            : "current",
    },
    {
      label: rejected ? "Rejected" : "Accepted",
      timestamp: terminal,
      detail:
        validationStarted && terminal
          ? delta(validationStarted, terminal)
          : terminal
            ? delta(admission.firstSeenAt, terminal)
            : undefined,
      state: rejected ? "failed" : terminal ? "done" : "todo",
    },
  ];

  return (
    <RecordedTimeline
      label="Node admission timeline"
      steps={steps}
      footer={
        <>
          Node admission record · {admission.attemptCount} validation{" "}
          {admission.attemptCount === 1 ? "attempt" : "attempts"} · {admission.requestCount}{" "}
          {admission.requestCount === 1 ? "request" : "requests"} · source:{" "}
          <span className="font-mono">{admission.submitSource}</span>
        </>
      }
    />
  );
}

const FINALIZATION_INDEX: Record<string, number> = {
  pending_submission: 1,
  submitted_local_finalization_pending: 2,
  submitted_unconfirmed: 2,
  observed_waiting_stability: 3,
  finalized: 4,
};

export function FinalizationTimeline({ finalization }: { finalization: BlockFinalization }) {
  const abandoned = finalization.status === "abandoned";
  const current = FINALIZATION_INDEX[finalization.status] ?? 1;
  const reached = (index: number): StepState =>
    current > index || finalization.status === "finalized"
      ? "done"
      : current === index
        ? "current"
        : "todo";

  const steps: TimelineStep[] = [
    {
      label: "Block closed",
      timestamp: finalization.blockEndTime,
      state: "done",
    },
    {
      label: "Queued for L1",
      timestamp: finalization.createdAt,
      detail: delta(finalization.blockEndTime, finalization.createdAt),
      state: reached(1),
    },
    {
      label: "Submitted",
      timestamp: null,
      detail: finalization.submitted_tx_hash ? "Cardano transaction recorded" : undefined,
      state: finalization.submitted_tx_hash ? reached(2) : "todo",
    },
    {
      label: "Observed on L1",
      timestamp: finalization.observedConfirmedAt,
      detail: finalization.observedConfirmedAt ? "Waiting for stability depth" : undefined,
      state: finalization.observedConfirmedAt ? reached(3) : "todo",
    },
    {
      label: abandoned ? "Abandoned" : "Finalized",
      timestamp: abandoned || finalization.status === "finalized" ? finalization.updatedAt : null,
      state: abandoned ? "failed" : reached(4),
    },
  ];

  return (
    <RecordedTimeline
      label="Block finalization timeline"
      steps={steps}
      footer={
        <span className="inline-flex flex-wrap items-center gap-2">
          Current settlement state:
          <StatusBadge status={finalization.status} />
          <span>Latest node update: {formatTimestamp(finalization.updatedAt)}</span>
        </span>
      }
    />
  );
}
