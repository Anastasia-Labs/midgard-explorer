"use client";

import Link from "next/link";
import { useState } from "react";
import { cn, truncateId } from "../../lib/format";
import { Icon } from "./icons";

export function Identifier({
  value,
  href,
  head = 8,
  tail = 8,
  full = false,
  external = false,
  externalLabel,
  className,
}: {
  value: string;
  /** Explicitly `| undefined`: under `exactOptionalPropertyTypes` a caller
   * holding a nullable href cannot otherwise pass it through. */
  href?: string | undefined;
  head?: number;
  tail?: number;
  full?: boolean;
  /** The href leaves this site. Marked rather than inferred from the URL, so
   * a reader is told where a link goes before they follow it and the
   * client-side router is not asked to handle an address it does not own. */
  external?: boolean;
  /** Where the external href goes, named. Supplied by the caller rather than
   * read from configuration here: this is a generic identifier, and a shared
   * primitive that knows what a Cardano explorer is cannot be reused for
   * anything else. */
  externalLabel?: string;
  className?: string;
}) {
  const display = full ? value : truncateId(value, head, tail);
  const text = (
    <span
      className={cn(
        "font-mono text-sm",
        // Truncated ids must never wrap mid-hash; full ids wrap on any char.
        full ? "break-all" : "whitespace-nowrap",
        className,
      )}
    >
      {display}
    </span>
  );
  const linkClass =
    "inline-flex min-h-9 items-center gap-1 text-text underline decoration-border-strong " +
    "underline-offset-2 transition-colors hover:text-link hover:decoration-link sm:min-h-0";

  return (
    <span className="inline-flex items-center gap-1.5">
      {href === undefined ? (
        text
      ) : external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          aria-label={externalLabel ?? `Open ${display} in a new tab`}
        >
          {text}
          <Icon name="external" size={12} />
        </a>
      ) : (
        <Link href={href} prefetch={false} className={linkClass}>
          {text}
        </Link>
      )}
      <CopyButton value={value} />
    </span>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Copy to clipboard"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded text-text-3 hover:bg-surface-2 hover:text-text-2"
      >
        {copied ? (
          <span aria-hidden className="text-success">
            ✓
          </span>
        ) : (
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
