import Link from "next/link";
import { Identifier } from "../domain/identifier";
import { truncateId } from "../../../lib/format";

/** Says a list is filtered, and how to leave the filter, while rows show. The
 * empty state carries its own Clear action, so this is for a list with rows.
 *
 * `ignored` is for a value that is not an ID at all: the list shows everything,
 * and without this the address bar says "filtered" while the page is not. */
export function FilterNote({
  label,
  value,
  clearHref,
  ignored = false,
}: {
  label: string;
  value: string;
  clearHref: string;
  ignored?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 mg-caption text-text-2">
      {ignored ? (
        <span className="min-w-0 break-all">
          Ignored filter <span className="font-mono">“{truncateId(value, 12, 6)}”</span>: not a{" "}
          {label} ID. Showing all.
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          Filtered by {label} <Identifier value={value} head={8} tail={6} />
        </span>
      )}
      <Link href={clearHref} className="text-link hover:text-link-hover hover:underline">
        Clear filter
      </Link>
    </div>
  );
}
