"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/format";

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

  const first = tabs[0];
  if (first === undefined) return null;

  const requested = params.get("tab");
  const current = tabs.find((t) => t.id === requested) ?? first;

  const select = (id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === tabs[0]?.id) next.delete("tab");
    else next.set("tab", id);
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  };

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
        className="mb-4 flex gap-0.5 overflow-x-auto border-b border-border"
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
                    "rounded-full px-1.5 py-px text-[11.5px] font-semibold tabular-nums",
                    on ? "bg-accent/15 text-accent" : "bg-surface-2 text-text-3",
                  )}
                >
                  {t.count}
                </span>
              ) : null}
              {on ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent"
                />
              ) : null}
            </button>
          );
        })}
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
