import Link from "next/link";
import type { BlockNeighbours } from "@midgard-explorer/contracts";
import { Icon } from "../base/icons";
import { cn } from "../../../lib/format";

/**
 * The headers either side of this one.
 *
 * Taken from cexplorer's block page, where the adjacent identifiers carry the
 * two arrows. Reading a chain means walking it, and returning to the list to
 * move one header is the kind of friction a reader notices every single time.
 *
 * A legacy row identifier is shown when one exists; otherwise the header hash
 * is shown. `blocks.height` is not a protocol height and is not synthesized.
 *
 * An absent neighbour renders as a disabled marker rather than disappearing, so
 * the control does not change shape at the ends of the chain. Disabled here
 * means what it means in `Pagination`: announced, and not focusable.
 */
export function BlockNav({ neighbours }: { neighbours: BlockNeighbours }) {
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
          aria-label={
            prev.height === null
              ? `Previous header, ${prev.header_hash}`
              : `Previous block, number ${prev.height}`
          }
          className={cn(base, "text-text-2 transition-colors hover:bg-surface-2 hover:text-text")}
        >
          <Icon name="chevronLeft" size={14} />
          {prev.height === null ? `${prev.header_hash.slice(0, 8)}…` : `#${prev.height}`}
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
          aria-label={
            next.height === null
              ? `Next header, ${next.header_hash}`
              : `Next block, number ${next.height}`
          }
          className={cn(base, "text-text-2 transition-colors hover:bg-surface-2 hover:text-text")}
        >
          {next.height === null ? `${next.header_hash.slice(0, 8)}…` : `#${next.height}`}
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
