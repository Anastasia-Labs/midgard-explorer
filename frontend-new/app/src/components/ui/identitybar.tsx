import type { ReactNode } from "react";
import { Icon } from "./icons";
import { CopyButton } from "./identifier";
import { Identicon } from "./identicon";
import { SummaryBand, type SummaryItem } from "./summary";

/** The page's subject identity: what this page is about, stated once, in full,
 * with the actions that apply to the identifier itself.
 *
 * `summary` attaches the record's headline figures to the same card. They are
 * identity too, and as a separate card below they were a second bordered block
 * answering the same question. */
export function IdentityBar({
  overline,
  value,
  badges,
  externalHref,
  externalLabel,
  summary,
  mark = false,
}: {
  overline: string;
  value: string;
  /** Show the generated mark for `value`. Set on the address page, where the
   * subject is an address and every list that linked here showed its mark: a
   * reader arriving from one of those lists should land on the same mark they
   * clicked. Off elsewhere, because a block hash or a transaction hash has no
   * mark anywhere else and inventing one here would be the only place it
   * appeared. */
  mark?: boolean;
  badges?: ReactNode;
  externalHref?: string;
  externalLabel?: string;
  summary?: SummaryItem[];
}) {
  return (
    <div
      data-region="identity"
      className="mb-4 overflow-hidden rounded-xl border border-border bg-surface px-4 py-3.5 shadow-(--mg-shadow)"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="mg-overline">{overline}</p>
        {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
      </div>
      {/* A 64-character hash wraps to three lines on a phone and costs more
          height than the answer below it. Small viewports get a single
          truncated line; the copy button still yields the full value, and it is
          shown in full from `sm` up. */}
      <div className="mt-2 flex items-center gap-1.5">
        {mark ? <Identicon seed={value} size={24} /> : null}
        <code className="min-w-0 truncate font-mono text-sm font-medium leading-normal text-text sm:hidden">
          {value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-10)}` : value}
        </code>
        <code className="hidden min-w-0 break-all font-mono text-body font-medium leading-normal text-text sm:inline">
          {value}
        </code>
        <span className="inline-flex shrink-0 gap-0.5">
          <CopyButton value={value} />
          {externalHref ? (
            <a
              href={externalHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={externalLabel ?? "Open on Cardano explorer"}
              className="inline-flex min-h-8 items-center gap-1.5 rounded border border-border-strong px-2.5 mg-caption text-text-2 transition-colors hover:border-link hover:text-link"
            >
              <span>{externalLabel ?? "View on Cardano explorer"}</span>
              <Icon name="external" size={14} />
            </a>
          ) : null}
        </span>
      </div>
      {summary && summary.length > 0 ? <SummaryBand items={summary} variant="attached" /> : null}
    </div>
  );
}
