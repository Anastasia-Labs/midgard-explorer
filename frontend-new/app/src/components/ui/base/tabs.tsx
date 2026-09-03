"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../../../lib/format";

export type Tab = {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
};

/** Tab state lives in the URL so a section is linkable and survives reload.
 * The first tab is the default and is represented by the absence of `?tab`. */
export function Tabs({ tabs, label = "Sections" }: { tabs: Tab[]; label?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Geometry of the active tab, in the tablist's own scrolled coordinates.
   * One shared indicator can only slide if it knows where to slide to, and the
   * previous per-button span had nothing to animate between. `ready` keeps the
   * very first paint from sliding in from x=0. */
  const [marker, setMarker] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });

  // Resolved before the empty-tabs guard below, because the hooks that measure
  // the indicator must run on every render and cannot sit after an early
  // return. With no tabs the index is simply -1 and the effects find no button.
  const requested = params.get("tab");
  const current = tabs.find((t) => t.id === requested) ?? tabs[0];
  const activeIndex = current ? tabs.findIndex((t) => t.id === current.id) : -1;

  const select = (id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === tabs[0]?.id) next.delete("tab");
    else next.set("tab", id);
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  };

  /* Measured after layout, before paint, so the bar never renders at a stale
     position. Re-measured on resize and on font load because both change the
     width of a label, and a bar measured against the old width sits wrong
     under the new one. */
  useLayoutEffect(() => {
    const measure = () => {
      const button = refs.current[activeIndex];
      const list = listRef.current;
      if (!button || !list) return;
      setMarker({
        left: button.offsetLeft,
        width: button.offsetWidth,
        ready: true,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    for (const button of refs.current) if (button) observer.observe(button);
    return () => observer.disconnect();
  }, [activeIndex, tabs.length]);

  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let cancelled = false;
    void fonts.ready.then(() => {
      if (cancelled) return;
      const button = refs.current[activeIndex];
      if (button) setMarker({ left: button.offsetLeft, width: button.offsetWidth, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, [activeIndex]);

  if (current === undefined) return null;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const n = (i + dir + tabs.length) % tabs.length;
    const next = tabs[n];
    if (!next) return;
    select(next.id);
    refs.current[n]?.focus();
  };

  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        ref={listRef}
        className="relative mb-4 flex gap-0.5 overflow-x-auto border-b border-border"
      >
        {tabs.map((t, i) => {
          const on = t.id === current.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={on}
              aria-controls={`panel-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 text-sm transition-colors",
                on ? "font-semibold text-text" : "font-medium text-text-2 hover:text-text",
              )}
            >
              {t.label}
              {t.count !== undefined ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-micro font-semibold tabular-nums",
                    on ? "bg-accent/15 text-accent" : "bg-surface-2 text-text-3",
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
        {/* One element for every tab, so switching tabs moves it rather than
            destroying one and creating another. Inset horizontally to match
            the padding the label sits in. The reduced-motion rule in
            globals.css collapses the transition to nothing. */}
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 h-0.5 rounded bg-accent transition-[transform,width] duration-200 ease-out"
          style={{
            transform: `translateX(${marker.left + 8}px)`,
            width: Math.max(0, marker.width - 16),
            opacity: marker.ready ? 1 : 0,
          }}
        />
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== current.id}
        >
          {t.content}
        </div>
      ))}
    </>
  );
}
