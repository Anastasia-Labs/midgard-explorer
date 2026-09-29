import { isHash32 } from "@midgard-explorer/contracts";
import { CopyButton, ShortId } from "./identifier";
import { Icon } from "../base/icons";
import { truncateId } from "../../../lib/format";
import { L1_EXPLORER_NAME, l1TxUrl } from "../../../lib/network";

/** Where a Cardano transaction hash should be read.
 *
 * `cardano` opens the transaction on the configured Cardano explorer. A valid
 * hash falls back to the internal page when none is configured or the source is
 * synthetic; a value that is not a Cardano hash is shown, never linked.
 * `midgard` always opens the internal page, which lists what the node recorded
 * about the hash. No page uses it today; search builds its own internal links
 * (lib/search.ts, components/search/hits.ts), because a pasted hash may be a
 * Midgard one.
 */
export type L1Destination = "midgard" | "cardano";

export function L1TxLink({
  hash,
  destination,
  marker = true,
  head,
  tail,
}: {
  hash: string;
  destination: L1Destination;
  /** Off where the label already says Cardano, such as a "Settlement" field. */
  marker?: boolean;
  /** Characters kept each side of the gap, for a narrow header figure. */
  head?: number;
  tail?: number;
}) {
  const valid = isHash32(hash);
  const external = destination === "cardano" && valid ? l1TxUrl(hash) : null;
  const href = external ?? (valid ? `/l1/transaction/${hash}` : null);
  // The string names the link for a screen reader; the page shows the same
  // hash in the standard rendered form.
  const short = truncateId(hash, head, tail);
  const shown = <ShortId value={hash} head={head ?? 8} tail={tail ?? 8} />;
  const linkClass =
    "inline-flex min-h-9 items-center whitespace-nowrap font-mono text-sm text-text underline decoration-border-strong sm:min-h-0 " +
    "underline-offset-2 transition-colors hover:text-link hover:decoration-link";

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      {marker ? (
        <span className="rounded border border-border-strong bg-surface-2 px-1 text-micro font-medium uppercase text-text-3">
          L1
          <span className="sr-only"> (Cardano layer 1)</span>
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        {href === null ? (
          <span className="whitespace-nowrap font-mono text-sm">{shown}</span>
        ) : external === null ? (
          <a
            href={href}
            className={linkClass}
            aria-label={`Midgard context for L1 transaction ${short}`}
          >
            {shown}
          </a>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} gap-0.5`}
            aria-label={`View L1 transaction ${short} on ${L1_EXPLORER_NAME ?? "the Cardano explorer"} (opens in a new tab)`}
          >
            {shown}
            <Icon name="external" size={12} />
          </a>
        )}
        <CopyButton value={hash} />
      </span>
    </span>
  );
}
