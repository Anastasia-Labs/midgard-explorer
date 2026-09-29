"use client";

import Link from "next/link";
import { useState } from "react";
import { ID_GAP, cn } from "../../../lib/format";
import { Icon } from "../base/icons";
import { ID_LINK_CLASS } from "../base/linkstyles";

/** `xs` is 390px, the width where the longer phone length first fits one row; the rest are Tailwind's. */
const BREAKPOINTS = ["xs", "sm", "lg", "xl"] as const;
type Breakpoint = (typeof BREAKPOINTS)[number];

/** A shortened hash in the site's standard form: head, the gap in the muted
 * colour with a little room either side, then tail. Short values show whole. */
export function ShortId({ value, head, tail }: { value: string; head: number; tail: number }) {
  if (value.length <= head + tail + ID_GAP.length) return <>{value}</>;
  return (
    <>
      {value.slice(0, head)}
      <span className="mx-0.5 text-text-3">{ID_GAP}</span>
      {value.slice(-tail)}
    </>
  );
}

/** Written out whole so Tailwind finds every class in the source. */
const SHOW_FROM: Record<Breakpoint, string> = {
  xs: "hidden min-[390px]:inline",
  sm: "hidden sm:inline",
  lg: "hidden lg:inline",
  xl: "hidden xl:inline",
};
const HIDE_FROM: Record<Breakpoint, string> = {
  xs: "min-[390px]:hidden",
  sm: "sm:hidden",
  lg: "lg:hidden",
  xl: "xl:hidden",
};

export function Identifier({
  value,
  href,
  head = 8,
  tail = 8,
  full = false,
  external = false,
  externalLabel,
  breakpoints,
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
  /** Other head and tail lengths from a breakpoint up, each in force until the
   * next one given, where the row has more or less room. `head` and `tail`
   * set the length below the first. One link and one copy button carry every
   * length, so nothing is duplicated for a screen reader. */
  breakpoints?: Partial<Record<Breakpoint, { head: number; tail: number }>>;
  className?: string;
}) {
  const lengths = BREAKPOINTS.flatMap((bp) => {
    const at = breakpoints?.[bp];
    return at === undefined ? [] : [{ bp, ...at }];
  });
  const display =
    full || lengths.length === 0 ? (
      full ? (
        value
      ) : (
        <ShortId value={value} head={head} tail={tail} />
      )
    ) : (
      <>
        <span className={HIDE_FROM[lengths[0]!.bp]}>
          <ShortId value={value} head={head} tail={tail} />
        </span>
        {lengths.map((at, i) => {
          const next = lengths[i + 1];
          return (
            <span key={at.bp} className={cn(SHOW_FROM[at.bp], next && HIDE_FROM[next.bp])}>
              <ShortId value={value} head={at.head} tail={at.tail} />
            </span>
          );
        })}
      </>
    );
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

  return (
    <span className="inline-flex items-center gap-1.5">
      {href === undefined ? (
        text
      ) : external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={ID_LINK_CLASS}
          aria-label={externalLabel ?? `Open ${display} in a new tab`}
        >
          {text}
          <Icon name="external" size={12} />
        </a>
      ) : (
        <Link href={href} prefetch={false} className={ID_LINK_CLASS}>
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
