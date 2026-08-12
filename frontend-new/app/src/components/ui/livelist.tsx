"use client";

import { useState } from "react";
import { newRowCount } from "../../lib/livelist";
import { Icon } from "./icons";

/**
 * Hold a polled list still, and offer the news as a row the reader applies.
 *
 * What is rendered changes only when `apply` is called, so a reader's position
 * is never taken from them by a timer. The first render shows whatever the
 * server sent, which is correct: there is nothing on screen yet to disturb.
 */
export function useHeldList<T>(
  incoming: readonly T[],
  keyOf: (row: T) => string,
): { rows: readonly T[]; pending: number; apply: () => void } {
  const [shown, setShown] = useState<readonly T[]>(incoming);
  const pending = newRowCount(shown, incoming, keyOf);
  return { rows: shown, pending, apply: () => setShown(incoming) };
}

/**
 * The news row itself.
 *
 * A button, not a notice: applying it is the reader's action. It sits above the
 * list rather than over it, so it takes its own space instead of covering the
 * first row it is telling them about.
 */
export function NewRowsBanner({
  count,
  noun,
  onApply,
}: {
  count: number;
  /** Singular form, e.g. "block". The plural adds an s. */
  noun: string;
  onApply: () => void;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onApply}
      // `polite`, never `assertive`: this is worth knowing, not worth
      // interrupting what a screen reader is already saying.
      aria-live="polite"
      className="flex w-full items-center justify-center gap-2 border-b border-border bg-accent/10 px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/15"
    >
      <Icon name="arrowRight" size={14} className="-rotate-90" />
      {count} new {noun}
      {count === 1 ? "" : "s"}. Show {count === 1 ? "it" : "them"}.
    </button>
  );
}
