"use client";

import { useEffect } from "react";

/**
 * The keyboard route into search.
 *
 * Bound to whichever box is the page's primary one: the hero on the overview,
 * the header everywhere else. `HeaderSearchBox` keeps those mutually exclusive,
 * so only one listener is ever mounted.
 */
export function useSearchShortcut(enabled: boolean, open: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        open();
        return;
      }
      // "/" is the explorer convention; never steal it while typing.
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, open]);
}
