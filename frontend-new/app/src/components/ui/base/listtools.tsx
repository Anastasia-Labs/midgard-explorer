"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";
import { cn } from "../../../lib/format";

/** Filtering and export for a list page.
 *
 * Filter state lives in the URL, not in component state. A filtered view a
 * reader cannot send to a colleague is half a feature: the whole reason to
 * narrow a list is usually to point at what is left.
 *
 * Export covers the rows currently in view and says so. Offering "export all"
 * over a paginated endpoint would either lie about its scope or fire a request
 * per page behind a button that looks instant.
 */

export type FilterOption = { value: string; label: string };

export function ListTools<Row>({
  filterKey,
  filterLabel,
  options,
  rows,
  filename,
  columns,
}: {
  /** Query-string key the filter reads and writes. */
  filterKey: string;
  filterLabel: string;
  options: FilterOption[];
  /** The rows currently rendered, which is exactly what export covers. */
  rows: readonly Row[];
  filename: string;
  /** Header plus a dotted path into the row. Paths rather than accessor
   * functions because this renders inside a Server Component's tree, and a
   * function cannot cross that boundary. */
  columns: Array<{ header: string; path: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get(filterKey) ?? "";
  const [copied, setCopied] = useState(false);

  const setFilter = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === "") next.delete(filterKey);
    else next.set(filterKey, value);
    // Changing a filter always returns to the first page: page 3 of an old
    // filter is a different, meaningless page 3 of the new one.
    next.delete("page");
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`);
  };

  const at = (row: Row, path: string): string => {
    let cursor: unknown = row;
    for (const key of path.split(".")) {
      if (cursor === null || typeof cursor !== "object") return "";
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return cursor === null || cursor === undefined ? "" : String(cursor);
  };

  const csv = () => {
    const escape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return [
      columns.map((c) => escape(c.header)).join(","),
      ...rows.map((r) => columns.map((c) => escape(at(r, c.path))).join(",")),
    ].join("\n");
  };

  const download = (content: string, name: string, mime: string) => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      data-region="list-tools"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor={`filter-${filterKey}`} className="mg-overline">
          {filterLabel}
        </label>
        <select
          id={`filter-${filterKey}`}
          value={active}
          onChange={(e) => setFilter(e.target.value)}
          /* `appearance-none` plus an inlined chevron. Left native, this was
             the one control on the page rendered by the operating system
             rather than by the design, and it looked unfinished beside
             everything around it. The arrow is a background image so the
             control stays a real <select> for keyboard and screen readers. */
          className="mg-select h-9 min-w-0 flex-1 appearance-none rounded border border-border-strong bg-(--mg-control-bg) py-0 pl-2.5 pr-8 text-sm text-text transition-colors hover:border-text-3 focus-visible:border-focus sm:flex-none"
        >
          <option value="">All</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {active !== "" ? (
          <button
            type="button"
            onClick={() => setFilter("")}
            className="inline-flex h-9 items-center rounded px-2 mg-caption text-text-3 hover:bg-surface-2 hover:text-text"
          >
            Clear
          </button>
        ) : null}
      </span>

      {/* Wraps to its own line below sm rather than squeezing the filter off
          the edge; at 320px there is no room for both. */}
      <span className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        <span className="mg-micro text-text-3">
          {rows.length} {rows.length === 1 ? "row" : "rows"} in view
        </span>
        <button
          type="button"
          onClick={() => download(csv(), `${filename}.csv`, "text/csv")}
          className={btn}
        >
          <Icon name="download" size={13} />
          CSV
        </button>
        <button
          type="button"
          onClick={() =>
            download(JSON.stringify(rows, null, 2), `${filename}.json`, "application/json")
          }
          className={btn}
        >
          <Icon name="download" size={13} />
          JSON
        </button>
        {/* Hidden below sm: it costs a third row on a phone, where copying the
            URL is a browser action the reader already has. */}
        <button
          type="button"
          onClick={copyLink}
          className={cn(btn, "hidden sm:inline-flex", copied && "text-success")}
        >
          {copied ? "Copied" : "Copy view"}
        </button>
      </span>
    </div>
  );
}

const btn =
  "inline-flex h-9 items-center gap-1.5 rounded border border-border-strong px-2.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text";
