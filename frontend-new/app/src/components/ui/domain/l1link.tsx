import { CopyButton } from "./identifier";
import { Icon } from "../base/icons";
import { truncateId } from "../../../lib/format";
import { L1_EXPLORER_NAME, l1TxUrl } from "../../../lib/network";

/** Where a Cardano transaction hash should be read.
 *
 * `midgard` is for a hash we hold a Midgard record for: a deposit, a
 * withdrawal, a forced transaction, a settlement. Its internal page exists to
 * say why the transaction matters here, which validator it touched and what
 * the datum decoded to, and it carries a link out for everything else.
 *
 * `cardano` is for a hash that is merely Cardano provenance, such as the
 * transaction that produced an input we are consuming. Midgard Explorer has
 * nothing to add about those and does not pretend to: they go straight to the
 * configured Cardano explorer.
 *
 * The caller declares which, and there is no default. The defect this replaces
 * was the same hash resolving internally in one view and externally in
 * another, which is a worse experience than either choice made consistently.
 */
export type L1Destination = "midgard" | "cardano";

export function L1TxLink({ hash, destination }: { hash: string; destination: L1Destination }) {
  const href = destination === "midgard" ? `/l1/transaction/${hash}` : l1TxUrl(hash);
  const short = truncateId(hash);
  const linkClass =
    "whitespace-nowrap font-mono text-sm text-text underline decoration-border-strong " +
    "underline-offset-2 transition-colors hover:text-link hover:decoration-link";

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded border border-border-strong bg-surface-2 px-1 text-micro font-medium uppercase text-text-3">
        L1
        <span className="sr-only"> (Cardano layer 1)</span>
      </span>
      {href === null ? (
        <span className="whitespace-nowrap font-mono text-sm">{short}</span>
      ) : destination === "midgard" ? (
        <a
          href={href}
          className={linkClass}
          aria-label={`Midgard context for L1 transaction ${short}`}
        >
          {short}
        </a>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${linkClass} inline-flex items-center gap-1`}
          aria-label={`View L1 transaction ${short} on ${L1_EXPLORER_NAME ?? "the Cardano explorer"}`}
        >
          {short}
          <Icon name="external" size={12} />
        </a>
      )}
      <CopyButton value={hash} />
    </span>
  );
}
