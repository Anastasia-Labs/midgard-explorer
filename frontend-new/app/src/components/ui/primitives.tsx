import type { ReactNode } from "react";
import { EntityIcon } from "./entity";
import { Icon, type IconName } from "./icons";
import type { EntityKind } from "../../lib/entities";
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

/** A mark above the headline, because a bare paragraph in a table body reads
 * as a failure rather than as an absence. Decorative: the headline is already
 * the information, and announcing it twice is noise. */
export function EmptyState({
  title,
  hint,
  icon = "inbox",
}: {
  title: string;
  hint?: string | undefined;
  icon?: IconName;
}) {
  return (
    <div className="p-8 text-center">
      <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-text-3">
        <Icon name={icon} size={19} />
      </span>
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
      <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon name="alertTriangle" size={19} />
      </span>
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

/** The glyph per tone, so a callout classifies itself before it is read and
 * without depending on hue.
 *
 * The vocabulary matches `StatusBadge`'s markers on purpose: a check concludes
 * well, a cross concludes badly. Warning and danger take different marks
 * because they are the pair most likely to be confused, and a shared mark
 * would add weight without adding information.
 *
 * Neutral asserts no tone, so it takes no mark. */
const CALLOUT_ICON: Record<CalloutTone, IconName | null> = {
  info: "info",
  warning: "alertTriangle",
  danger: "x",
  success: "check",
  neutral: null,
};

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
  const icon = CALLOUT_ICON[tone];
  return (
    <div className={cn("rounded-lg border bg-surface p-4", toneClass)}>
      <p className="flex items-start gap-2 font-medium">
        {icon ? (
          <span className="mt-0.5 shrink-0">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
        <span className="min-w-0">{title}</span>
      </p>
      {children ? (
        <div className={cn("mt-1 text-sm text-text-2", icon ? "ps-6" : null)}>{children}</div>
      ) : null}
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
          "mt-2 text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-3xl",
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
  entity,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  /** The record type this page shows. Renders the type glyph in the type
   * colour beside the title, which is already the word: glyph, word and colour
   * together, never colour alone (4.3.2). */
  entity?: EntityKind;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-page-title sm:text-title">
          {entity ? (
            <span className="mg-field-icon">
              <EntityIcon kind={entity} size={22} />
            </span>
          ) : null}
          {title}
        </h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-body text-page-copy">{subtitle}</p> : null}
        {meta ? (
          <div className="mg-field-surface mt-2 flex w-fit flex-wrap items-center gap-x-4 gap-y-1 mg-caption text-text-2">
            {meta}
          </div>
        ) : null}
      </div>
      {children ? <div className="mg-field-surface">{children}</div> : null}
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
          <h2 className="text-body font-semibold text-text">{title}</h2>
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
        "inline-flex items-center rounded border px-1.5 py-px font-mono text-micro font-semibold",
        layer === "L2"
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-info/30 bg-info/10 text-info",
      )}
    >
      {layer}
    </span>
  );
}

/** A count in a dense table.
 *
 * Zero is the overwhelmingly common value in these columns, and rendering it
 * at the same weight as a real count turned four columns of `/blocks` into a
 * grid of identical grey digits with nothing for the eye to land on. An em
 * dash at the muted weight says "none" more directly than `0` does, and it
 * clears the column so the values that exist can be seen.
 *
 * The distinction is carried by weight and character, not by colour alone: the
 * dash reads as absence in monochrome and to a screen reader, which is given
 * the word rather than the glyph.
 */
export function Count({ value, className }: { value: number | string; className?: string }) {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || n === 0) {
    return (
      <span className={cn("text-text-3", className)}>
        <span aria-hidden>&mdash;</span>
        <span className="sr-only">none</span>
      </span>
    );
  }
  return (
    <span className={cn("font-semibold tabular-nums text-text", className)}>
      {n.toLocaleString("en-US")}
    </span>
  );
}

/** The small bordered tag that annotates a value: "script", "datum", "3 assets".
 *
 * This existed three times, character for character, as a local `Chip` in
 * `utxoflow`, `utxoflowcanvas` and the transaction tabs, plus twice more
 * inline and once as a `Flag` on the address page. Six copies of one recipe is
 * why the type sweep had six places to visit for one decision, and it is the
 * shape the next arbitrary size would have arrived in. The size lives in
 * `--text-micro` now, so this component is the only thing that has to know it.
 *
 * `on` is the surface underneath, not a meaning: the same tag sits on a flow
 * node (`surface`) and inside a card (`surface-2`), and the border needs the
 * one it is actually drawn against. `emphasis` is the only semantic axis, and
 * it has two values because the tags that carry a fact ("Mint", "Burn") should
 * outrank the ones that carry a property ("datum"). Coloured status pills are
 * deliberately not folded in here: those encode state and belong with the
 * status vocabulary, not with this. */
export function Chip({
  children,
  on = "surface",
  emphasis = "muted",
  className,
}: {
  children: ReactNode;
  on?: "surface" | "surface-2";
  emphasis?: "muted" | "strong";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded border border-border px-1.5 py-px text-micro",
        on === "surface" ? "bg-surface" : "bg-surface-2",
        emphasis === "muted" ? "text-text-3" : "text-text-2",
        className,
      )}
    >
      {children}
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
        // A one-pixel lit top edge. Cheap, static, and the difference between
        // a card that sits on the page and an outline drawn on it.
        "border-t-(--mg-bevel)",
        className,
      )}
    >
      {children}
    </section>
  );
}
