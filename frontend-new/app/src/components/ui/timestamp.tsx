"use client";

import { useSyncExternalStore } from "react";
import { cn, formatTimestamp, relativeTime } from "../../lib/format";

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

export function Timestamp({ iso, className }: { iso: string; className?: string }) {
  const nowMs = useSyncExternalStore(subscribe, getNow, getServerNow);
  const exact = formatTimestamp(iso);
  // The exact instant is read by assistive tech, not only hover: `title`
  // alone is not reachable by keyboard or screen reader.
  return (
    <time
      dateTime={iso}
      title={exact}
      className={cn(
        "inline-block min-w-[7.5ch] whitespace-nowrap text-[13px] text-text-3 tabular-nums",
        className,
      )}
    >
      <span aria-hidden>{nowMs === 0 ? exact : relativeTime(iso, nowMs)}</span>
      <span className="sr-only">{exact}</span>
    </time>
  );
}
