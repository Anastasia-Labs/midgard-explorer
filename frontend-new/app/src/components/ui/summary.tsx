import { cn } from "../../lib/format";
import type { GlossaryTerm } from "../../lib/glossary";
import { FieldLabel } from "./infotip";

export type SummaryItem = {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  emphasis?: boolean;
  term?: GlossaryTerm;
};

/** Cells wrap at a minimum width and the last row grows to fill the width.
 *
 * Two earlier versions got this wrong in different ways. The first fixed the
 * column count per breakpoint and painted invisible filler cells over the
 * remainder, because the 1px gap showing the container background through made
 * an unfilled row read as a metric that had failed to load. The second replaced
 * that with a grid of `auto-fit` tracks and claimed the last row stretched.
 * It does not: `auto-fit` collapses empty tracks but distributes the width
 * across the tracks it keeps, so at phone width a three or five item band still
 * left one cell of exposed border. That was verified at 1440px only, where five
 * tracks happen to fit and the bug is invisible.
 *
 * Flex wrapping is what actually has the stretching behaviour the grid was
 * being asked for: every cell shares one basis and grows, so a row holding
 * fewer cells than the one above simply divides the same width between them,
 * and there is no such thing as an empty cell to paint over.
 */

export function SummaryBand({ items }: { items: SummaryItem[] }) {
  return (
    <dl className="mb-5 flex flex-wrap gap-px overflow-hidden rounded-lg border border-border bg-border">
      {/* `grow` rather than `flex-1` on the cells: `flex-1` also sets a basis
          of 0, and which of the two declarations wins depends on the order
          Tailwind emits them, not on the order written here. */}
      {items.map((it) => (
        <div key={it.label} className="min-w-0 grow basis-38 bg-surface px-4 py-3.5">
          <dt className="mg-overline">
            <FieldLabel label={it.label} term={it.term} />
          </dt>
          <dd className="mt-1">
            {/* Never `truncate`. These values are mostly quantities, and a
                clipped number is not an abbreviated number, it is a different
                number: 4,500,000,000 rendering as "4,500,0…" states something
                false. Wrapping is allowed to break mid-token as a last resort,
                which is ugly at worst and honest always. */}
            {/* `Timestamp` sets `whitespace-nowrap` so a relative time does not
                reflow as it ticks. That is right in a table cell and wrong
                here: past thirty days `relativeTime` falls back to the full
                absolute instant, which does not fit a band cell at phone width
                and was being clipped mid-value. Inside a band, wrapping wins. */}
            <span
              className={cn(
                "block font-semibold tabular-nums text-text [overflow-wrap:anywhere]",
                "[&_time]:whitespace-normal",
                it.emphasis ? "text-[26px] leading-tight" : "text-[18px] leading-snug",
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
