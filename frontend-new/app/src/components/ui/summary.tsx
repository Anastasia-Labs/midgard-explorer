import { cn } from "../../lib/format";

export type SummaryItem = {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  emphasis?: boolean;
};

/** Cells are painted by the container background showing through a 1px gap, so
 * a row the items do not fill leaves a solid block that reads as a metric that
 * failed to load. Fillers cover the remainder at each breakpoint's column
 * count: 2 at base, 3 at sm, 4 at lg. Class strings stay literal so Tailwind
 * can see them. */
function fillerClasses(count: number): string[] {
  const remainder = (columns: number) => (columns - (count % columns)) % columns;
  const [r2, r3, r4] = [remainder(2), remainder(3), remainder(4)];
  return Array.from({ length: Math.max(r2, r3, r4) }, (_, i) =>
    cn(
      r2 > i ? "block" : "hidden",
      r3 > i ? "sm:block" : "sm:hidden",
      r4 > i ? "lg:block" : "lg:hidden",
    ),
  );
}

export function SummaryBand({ items }: { items: SummaryItem[] }) {
  const fillers = fillerClasses(items.length);
  return (
    <dl className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="min-w-0 bg-surface px-4 py-3.5">
          <dt className="mg-overline">{it.label}</dt>
          <dd className="mt-1">
            <span
              className={cn(
                "block truncate font-display font-semibold tabular-nums text-text",
                it.emphasis ? "text-[26px] leading-none" : "text-[18px]",
              )}
            >
              {it.value}
            </span>
            {it.sub ? <span className="mt-1 block text-[12px] text-text-3">{it.sub}</span> : null}
          </dd>
        </div>
      ))}
      {fillers.map((visibility, i) => (
        <div key={`filler-${i}`} aria-hidden="true" className={cn("bg-surface", visibility)} />
      ))}
    </dl>
  );
}
