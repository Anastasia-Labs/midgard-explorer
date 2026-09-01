"use client";

import { useSyncExternalStore } from "react";
import { cn, formatTimestamp, relativeTime } from "../../../lib/format";

/** Shared 30 s ticker so every Timestamp re-renders together. */
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  timer ??= setInterval(() => {
    now = Date.now();
    listeners.forEach((fn) => fn());
  }, 30_000);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
};

const getNow = () => now;
const getServerNow = () => 0;

export function Timestamp({
  iso,
  exact: showExact = false,
  className,
}: {
  iso: string;
  /** Show the absolute instant beside the relative one. Every reference
   * explorer does this on detail pages, where there is room for it and where a
   * reader wants the moment rather than the distance. Lists stay relative. */
  exact?: boolean;
  className?: string;
}) {
  const nowMs = useSyncExternalStore(subscribe, getNow, getServerNow);
  const exact = formatTimestamp(iso);
  const relative = nowMs === 0 ? exact : relativeTime(iso, nowMs);
  // No `title`: hover reached neither touch nor keyboard. The absolute instant
  // is either rendered beside the relative one or read out by assistive tech.
  return (
    <time
      dateTime={iso}
      className={cn(
        "inline-block whitespace-nowrap mg-caption text-text-3 tabular-nums",
        showExact ? "min-w-0" : "min-w-[7.5ch]",
        className,
      )}
    >
      <span aria-hidden>{relative}</span>
      {showExact && relative !== exact ? (
        <span aria-hidden className="text-text-3">
          {" · "}
          {exact}
        </span>
      ) : null}
      <span className="sr-only">{exact}</span>
    </time>
  );
}
