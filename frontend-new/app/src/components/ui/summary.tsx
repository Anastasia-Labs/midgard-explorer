import { cn } from "../../lib/format";

export type SummaryItem = {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  emphasis?: boolean;
};

/** Cells are laid out with `auto-fit`, so the track count follows the width and
 * the last row stretches to fill it.
 *
 * The previous version fixed the column count per breakpoint and painted
 * invisible filler cells over the remainder, because the 1px gap showing the
 * container background through made an unfilled row read as a metric that had
 * failed to load. Fillers solved the artefact but not the cause: a three-item
 * band still rendered a four-column grid with a quarter of it empty. Letting
 * the tracks size themselves removes both.
 */

export function SummaryBand({ items }: { items: SummaryItem[] }) {
  return (
    <dl className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-px overflow-hidden rounded-lg border border-border bg-border">
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
            {it.sub ? <span className="mt-1 block mg-micro text-text-3">{it.sub}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
