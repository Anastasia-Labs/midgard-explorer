"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, glossaryText, type GlossaryTerm } from "../../lib/glossary";
import { cn } from "../../lib/format";
import { Icon } from "./icons";

const VIEWPORT_MARGIN = 8;
const GAP = 8;
const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 120;

type OpenReason = "hover" | "focus" | "pinned" | null;

type TipProps = {
  /** Free-form help remains available for record-specific states. Protocol
   * terms should use `term` so every occurrence shares one explanation. */
  explain?: string | undefined;
  term?: GlossaryTerm | undefined;
  /** What the tip is about, used to name the trigger for screen readers. */
  subject?: string | undefined;
  className?: string | undefined;
};

/** Collision-safe help for mouse, keyboard, touch, and screen readers.
 *
 * The panel is portalled to `body` and uses fixed coordinates. That keeps it
 * out of clipped tables, cards, tabs, and sticky headers while the positioning
 * pass places it above the trigger, flips it below only when there is no room,
 * and clamps both axes to the viewport.
 */
export function InfoTip({ explain, term, subject, className }: TipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerPressed = useRef(false);
  const [reason, setReason] = useState<OpenReason>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });

  const entry = term ? GLOSSARY[term] : null;
  const text = term ? glossaryText(term) : explain;
  const label = subject ?? entry?.label ?? "more information";
  const open = reason !== null;

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const showAfterDelay = (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse" || reason === "pinned") return;
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(() => setReason("hover"), HOVER_OPEN_MS);
  };

  const hideAfterDelay = () => {
    if (reason === "pinned" || reason === "focus") return;
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setReason(null), HOVER_CLOSE_MS);
  };

  const keepOpen = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  };

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const width = Math.min(box.width, window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = Math.min(
      Math.max(anchor.left + anchor.width / 2 - width / 2, VIEWPORT_MARGIN),
      window.innerWidth - width - VIEWPORT_MARGIN,
    );
    const above = anchor.top - GAP - box.height;
    const below = anchor.bottom + GAP;
    // Above by preference. A tip opening downward covers the rows under the
    // label it describes, which on a detail grid or a table is the data the
    // reader is trying to read. Opening upward covers what they have already
    // passed. Below is the fallback when there is no room above.
    const top =
      above >= VIEWPORT_MARGIN
        ? above
        : below + box.height <= window.innerHeight - VIEWPORT_MARGIN
          ? below
          : Math.min(
              Math.max(above, VIEWPORT_MARGIN),
              window.innerHeight - box.height - VIEWPORT_MARGIN,
            );
    setPosition({ left, top, ready: true });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onMove = () => updatePosition();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      observer?.disconnect();
      // Closing invalidates the measurement. Retiring it here, as this open
      // cycle tears down, rather than from a second effect watching `open`:
      // the two fire at the same moment, and the cleanup cannot be read as
      // state feeding back into a render.
      setPosition((was) => ({ ...was, ready: false }));
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      clearTimers();
      setReason(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [clearTimers, open]);

  useEffect(() => clearTimers, [clearTimers]);

  if (!text) return null;

  const panel = open
    ? createPortal(
        <span
          ref={panelRef}
          id={id}
          role="tooltip"
          onPointerEnter={keepOpen}
          onPointerLeave={hideAfterDelay}
          style={{
            position: "fixed",
            left: position.left,
            top: position.top,
            maxWidth: `min(20rem, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
            visibility: position.ready ? "visible" : "hidden",
          }}
          className={cn(
            "z-100 rounded-md border border-border-strong bg-surface px-3 py-2",
            "text-xs leading-relaxed font-normal text-text-2 shadow-lg",
          )}
        >
          {entry ? (
            <>
              <span className="font-semibold text-text">{entry.meaning}</span>{" "}
              <span>{entry.consequence}</span>
              {/* The rule separates the record-specific note from the shared
                  definition, so it carries no "Context:" label: a word naming
                  the kind of information is not information. */}
              {explain ? (
                <span className="mt-1.5 block border-t border-border pt-1.5 text-text-3">
                  {explain}
                </span>
              ) : null}
            </>
          ) : (
            text
          )}
        </span>,
        document.body,
      )
    : null;

  return (
    <span
      className={cn("inline-flex items-center", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          clearTimers();
          setReason(null);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        aria-label={`About ${label}`}
        onPointerEnter={showAfterDelay}
        onPointerLeave={hideAfterDelay}
        onPointerDown={() => {
          pointerPressed.current = true;
        }}
        onFocus={() => {
          if (!pointerPressed.current) {
            clearTimers();
            setReason("focus");
          }
        }}
        onBlur={() => {
          pointerPressed.current = false;
          if (reason === "focus") setReason(null);
        }}
        onClick={() => {
          pointerPressed.current = false;
          clearTimers();
          setReason((was) => (was === "pinned" ? null : "pinned"));
        }}
        className={cn(
          "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full",
          "text-text-3 transition-colors hover:text-text-2",
          "after:absolute after:-inset-3.5 after:content-['']",
          open && "text-text",
        )}
      >
        <Icon name="info" size={14} />
      </button>
      {panel}
    </span>
  );
}

/** A detail-list label with its help glyph after it. */
export function FieldLabel({
  label,
  explain,
  term,
  className,
}: {
  label: string;
  explain?: string | undefined;
  term?: GlossaryTerm | undefined;
  className?: string | undefined;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span>{label}</span>
      {explain || term ? <InfoTip explain={explain} term={term} subject={label} /> : null}
    </span>
  );
}
