"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/format";

/** Marks a figure that has just changed.
 *
 * The overview polls, so numbers move without anything to say they moved. A
 * reader watching for the chain tip to advance had to compare against memory.
 * One brief tint answers "did that just update?" without a layout shift and
 * without competing with the value itself.
 *
 * It fires only on a change, never on mount, so arriving at the page does not
 * look like a burst of activity that did not happen. The reduced-motion rule in
 * globals.css collapses the animation for anyone who asked for that, leaving
 * the value plainly readable.
 */
export function LiveValue({
  value,
  children,
}: {
  /** The comparable identity of the figure. A change here is what tints. */
  value: string | number | null;
  children: React.ReactNode;
}) {
  const previous = useRef(value);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), 1600);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span className={cn("inline-block rounded-sm px-1 -mx-1", changed && "mg-tint")}>
      {children}
    </span>
  );
}
