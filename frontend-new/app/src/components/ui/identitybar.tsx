import type { ReactNode } from "react";
import { Icon } from "./icons";
import { CopyButton } from "./identifier";

/** The page's subject identity: what this page is about, stated once, in full,
 * with the actions that apply to the identifier itself. */
export function IdentityBar({
  overline,
  value,
  badges,
  externalHref,
  externalLabel,
}: {
  overline: string;
  value: string;
  badges?: ReactNode;
  externalHref?: string;
  externalLabel?: string;
}) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3.5 shadow-(--mg-shadow)">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="mg-overline">{overline}</p>
        {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <code className="break-all font-mono text-[14.5px] font-medium leading-normal text-text">
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
              title={externalLabel ?? "Open on Cardano explorer"}
              className="flex size-7 items-center justify-center rounded text-text-3 hover:text-text-2"
            >
              <Icon name="external" size={14} />
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}
