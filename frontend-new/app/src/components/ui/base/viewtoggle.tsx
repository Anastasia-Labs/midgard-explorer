"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../../lib/format";

export type View = {
  id: string;
  label: string;
  content: ReactNode;
};

/**
 * A segmented control that swaps between two renderings of the same data.
 *
 * Deliberately not a `Tabs`. Tabs say "different content is behind each one",
 * and the toggle says "the same content, drawn another way", which is why the
 * semantics here are a radio group: the reader is choosing a representation,
 * not navigating. Like `Tabs`, the choice lives in the URL so a view is
 * linkable, and the first entry is the default and is represented by the
 * absence of the parameter.
 *
 * Both renderings are rendered on the server and one is hidden, so switching
 * costs no request and the non-default view is present for a reader who arrives
 * with JavaScript still loading.
 */
export function ViewToggle({
  views,
  label,
  param = "view",
}: {
  views: View[];
  label: string;
  param?: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const first = views[0];
  if (first === undefined) return null;

  const current = views.find((v) => v.id === params.get(param)) ?? first;

  const select = (id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === first.id) next.delete(param);
    else next.set(param, id);
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const n = (i + dir + views.length) % views.length;
    const next = views[n];
    if (!next) return;
    select(next.id);
    refs.current[n]?.focus();
  };

  return (
    <>
      <div
        role="radiogroup"
        aria-label={label}
        className="mb-3 inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5"
      >
        {views.map((v, i) => {
          const on = v.id === current.id;
          return (
            <button
              key={v.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => select(v.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "rounded-[7px] px-3 py-1.5 text-caption font-medium transition-colors",
                on
                  ? "bg-surface text-text shadow-sm ring-1 ring-border"
                  : "text-text-2 hover:text-text",
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      {views.map((v) => (
        <div key={v.id} hidden={v.id !== current.id}>
          {v.content}
        </div>
      ))}
    </>
  );
}
