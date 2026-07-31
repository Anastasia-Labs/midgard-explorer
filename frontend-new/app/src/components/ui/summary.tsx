import { cn } from "../../lib/format";

export type SummaryItem = {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  emphasis?: boolean;
};

export function SummaryBand({ items }: { items: SummaryItem[] }) {
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
    </dl>
  );
}
