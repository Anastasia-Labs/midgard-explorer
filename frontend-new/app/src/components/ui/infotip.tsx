"use client";

import { useId, useRef, useState } from "react";
import { cn } from "../../lib/format";
import { Icon } from "./icons";

/** Help text that a touch or keyboard user can actually reach.
 *
 * `title=` put every explanation behind a mouse hover: invisible on touch, and
 * announced inconsistently by screen readers. The reference explorers all use a
 * small glyph before the label that opens on click, so this follows that rather
 * than inventing a third pattern.
 *
 * The glyph is 16px but its hit area is 44px, expanded by a pseudo-element so
 * the extra target costs no layout. Focus opens it for keyboard users, but a
 * pointer press is remembered so a mouse click does not open on focus and then
 * close again on click.
 */
export function InfoTip({
  explain,
  subject,
  className,
}: {
  explain: string;
  /** What the tip is about, used to name the trigger for screen readers. */
  subject?: string | undefined;
  className?: string | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const fromPointer = useRef(false);

  return (
    <span
      className={cn("relative inline-flex items-center", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        aria-label={subject ? `About ${subject}` : "More information"}
        onPointerDown={() => {
          fromPointer.current = true;
        }}
        onFocus={() => {
          if (!fromPointer.current) setOpen(true);
        }}
        onBlur={() => {
          fromPointer.current = false;
          setOpen(false);
        }}
        onClick={() => {
          fromPointer.current = false;
          setOpen((was) => !was);
        }}
        className={cn(
          "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full",
          "text-text-3 transition-colors hover:text-text-2",
          // 16px glyph, 44px target, no layout cost.
          "after:absolute after:-inset-3.5 after:content-['']",
          open && "text-text",
        )}
      >
        <Icon name="info" size={14} />
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "absolute top-full left-0 z-50 mt-1.5 w-max max-w-64 rounded-md border border-border-strong",
            "bg-surface px-2.5 py-1.5 text-xs leading-relaxed font-normal text-text-2 shadow-lg",
          )}
        >
          {explain}
        </span>
      ) : null}
    </span>
  );
}

/** A detail-list label with its help glyph in front of it.
 *
 * The references apply the glyph to every field in a detail list rather than to
 * selected ones: a marker on some fields and not others reads as "this one is
 * confusing". Pass `explain` for every field that has something to say.
 */
export function FieldLabel({
  label,
  explain,
  className,
}: {
  label: string;
  explain?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {explain ? <InfoTip explain={explain} subject={label} /> : null}
      <span>{label}</span>
    </span>
  );
}
