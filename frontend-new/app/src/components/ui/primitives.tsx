import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cn } from "../../lib/format";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("mg-shimmer rounded", className)} />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string | undefined }) {
  return (
    <div className="p-8 text-center">
      <p className="text-text-2">{title}</p>
      {hint ? <p className="mt-1 text-sm text-text-3">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div role="alert" className="p-8 text-center">
      <p className="text-danger">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border border-border-strong px-3 py-1.5 text-sm text-text hover:bg-surface-2"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export type CalloutTone = "info" | "warning" | "danger" | "success" | "neutral";

export function Callout({
  tone,
  title,
  children,
}: {
  tone: CalloutTone;
  title: ReactNode;
  children?: ReactNode;
}) {
  const toneClass = {
    info: "border-info/40 text-info",
    warning: "border-warning/40 text-warning",
    danger: "border-danger/40 text-danger",
    success: "border-success/40 text-success",
    neutral: "border-border-strong text-text-2",
  }[tone];
  return (
    <div className={cn("rounded-lg border bg-surface p-4", toneClass)}>
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-text-2">{children}</div> : null}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  tone?: "success" | "danger" | "warning";
}) {
  const toneText =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "warning"
          ? "text-warning"
          : "text-text";
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-(--mg-shadow)">
      <div className="flex items-center justify-between gap-2">
        <p className="mg-overline">{label}</p>
        {icon ? (
          <span className={cn("opacity-80", tone ? toneText : "text-text-3")}>
            <Icon name={icon} size={15} />
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-2 font-display text-[28px] font-semibold leading-none tracking-tight tabular-nums",
          toneText,
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 mg-caption text-text-3">{sub}</p> : null}
    </div>
  );
}

export function MetricStrip({ children }: { children: ReactNode }) {
  // Two columns from the smallest viewport: stacked full-width tiles pushed the
  // first recent row off a phone screen.
  return <div className="mb-4 grid grid-cols-2 gap-3">{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  meta,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-text">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-[15px] text-text-2">{subtitle}</p> : null}
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 mg-caption text-text-2">
            {meta}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold text-text">{title}</h2>
          {subtitle ? <p className="mt-0.5 mg-caption text-text-3">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

export function L1L2Badge({ layer }: { layer: "L1" | "L2" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px font-mono text-[11px] font-semibold",
        layer === "L2"
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-info/30 bg-info/10 text-info",
      )}
    >
      {layer}
    </span>
  );
}

export function Card({
  children,
  className,
}: {
  children?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-surface shadow-(--mg-shadow)",
        className,
      )}
    >
      {children}
    </section>
  );
}
