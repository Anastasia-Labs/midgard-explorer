import Link from "next/link";
import type { BlockNeighbours } from "@midgard-explorer/contracts";
import { Icon } from "./icons";
import { cn } from "../../lib/format";

/**
 * The blocks either side of this one.
 *
 * Taken from cexplorer's block page, where the height itself carries the two
 * arrows. Reading a chain means walking it, and returning to the list to move
 * one block is the kind of friction a reader notices every single time.
 *
 * The heights are shown, not just arrows, because Midgard block heights are not
 * consecutive: a height is the lowest row id in its block, so the block before
 * #20 is #14. An unlabelled arrow would leave a reader guessing where it goes.
 *
 * An absent neighbour renders as a disabled marker rather than disappearing, so
 * the control does not change shape at the ends of the chain. Disabled here
 * means what it means in `Pagination`: announced, and not focusable.
 */
export function BlockNav({ neighbours }: { neighbours: BlockNeighbours | undefined }) {
  if (!neighbours) return null;
  const { prev, next } = neighbours;
  if (!prev && !next) return null;

  const base =
    "inline-flex h-9 items-center gap-1 rounded border border-border-strong px-2 mg-caption tabular-nums";
  return (
    <nav aria-label="Adjacent blocks" className="inline-flex items-center gap-1.5">
      {prev ? (
        <Link
          href={`/block/${prev.header_hash}`}
          prefetch={false}
          aria-label={`Previous block, number ${prev.height}`}
          className={cn(base, "text-text-2 transition-colors hover:bg-surface-2 hover:text-text")}
        >
          <Icon name="chevronLeft" size={14} />#{prev.height}
        </Link>
      ) : (
        <span
          aria-disabled="true"
          aria-label="No earlier block"
          className={cn(base, "pointer-events-none text-text-3 opacity-40")}
        >
          <Icon name="chevronLeft" size={14} />
          Oldest
        </span>
      )}
      {next ? (
        <Link
          href={`/block/${next.header_hash}`}
          prefetch={false}
          aria-label={`Next block, number ${next.height}`}
          className={cn(base, "text-text-2 transition-colors hover:bg-surface-2 hover:text-text")}
        >
          #{next.height}
          <Icon name="chevronRight" size={14} />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          aria-label="This is the newest block"
          className={cn(base, "pointer-events-none text-text-3 opacity-40")}
        >
          Tip
          <Icon name="chevronRight" size={14} />
        </span>
      )}
    </nav>
  );
}
