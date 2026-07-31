import Link from "next/link";
import type { ReactNode } from "react";
import { LedgerRow, type LedgerRowSpec } from "./mobilerow";
import { EmptyState, ErrorState, TableSkeleton } from "./primitives";

const HIDE_CLASS = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
} as const;

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "right";
  hideBelow?: keyof typeof HIDE_CLASS;
};

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  caption,
  state = "success",
  errorMessage,
  onRetry,
  emptyTitle = "No data yet",
  emptyHint,
  mobileRow,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  keyOf: (row: T) => string;
  caption: string;
  state?: "loading" | "error" | "success";
  errorMessage?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyHint?: string;
  mobileRow?: (row: T) => LedgerRowSpec;
}) {
  if (state === "loading") return <TableSkeleton />;
  if (state === "error") {
    return <ErrorState message={errorMessage ?? "Failed to load."} onRetry={onRetry} />;
  }
  if (rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;

  return (
    <>
      {mobileRow ? (
        /* Mobile (<sm): prioritized ledger rows separated by dividers. */
        <ul className="divide-y divide-border sm:hidden">
          {rows.map((row) => (
            <li key={keyOf(row)}>
              <LedgerRow spec={mobileRow(row)} />
            </li>
          ))}
        </ul>
      ) : (
        /* Fallback: each row as a card with EVERY column's label/value,
           nothing is lost to hidden columns on small screens. */
        <ul className="space-y-3 p-4 sm:hidden">
          {rows.map((row) => (
            <li
              key={keyOf(row)}
              className="rounded-lg border border-border bg-surface p-3 shadow-(--mg-shadow)"
            >
              <dl className="space-y-1.5">
                {columns.map((c) => (
                  <div key={c.header} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="shrink-0 text-xs uppercase tracking-wide text-text-3">
                      {c.header}
                    </dt>
                    <dd className="min-w-0 text-right">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border-strong text-left text-[11px] uppercase tracking-wider text-text-3">
              {columns.map((c) => (
                <th
                  key={c.header}
                  scope="col"
                  className={`px-4 py-2.5 font-medium ${c.hideBelow ? HIDE_CLASS[c.hideBelow] : ""} ${c.align === "right" ? "text-right tabular-nums" : ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={keyOf(row)}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/50"
              >
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={`px-4 py-3 align-middle ${c.hideBelow ? HIDE_CLASS[c.hideBelow] : ""} ${c.align === "right" ? "text-right tabular-nums" : ""}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Pagination({
  page,
  hasNextPage,
  hrefFor,
  total,
  limit,
}: {
  page: number;
  hasNextPage: boolean;
  hrefFor: (page: number) => string;
  total?: number;
  limit?: number;
}) {
  const totalPages =
    total !== undefined && limit !== undefined && limit > 0
      ? Math.max(1, Math.ceil(total / limit))
      : undefined;
  const from = limit !== undefined ? (page - 1) * limit + 1 : undefined;
  const to = limit !== undefined && total !== undefined ? Math.min(page * limit, total) : undefined;

  const pageWindow: number[] = [];
  if (totalPages !== undefined) {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    for (let p = start; p <= end; p++) pageWindow.push(p);
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm"
    >
      <span className="text-text-3 tabular-nums">
        {from !== undefined && to !== undefined && total !== undefined
          ? `Showing ${from}–${to} of ${total.toLocaleString("en-US")}`
          : `Page ${page}`}
      </span>
      <div className="flex items-center gap-1">
        <PageLink href={hrefFor(1)} disabled={page === 1} label="First page">
          «
        </PageLink>
        <PageLink href={hrefFor(page - 1)} disabled={page === 1} label="Previous page">
          Prev
        </PageLink>
        {pageWindow.map((p) => (
          <PageLink key={p} href={hrefFor(p)} current={p === page} label={`Page ${p}`}>
            {p}
          </PageLink>
        ))}
        <PageLink href={hrefFor(page + 1)} disabled={!hasNextPage} label="Next page">
          Next
        </PageLink>
        <PageLink
          href={hrefFor(totalPages ?? page)}
          disabled={totalPages === undefined || page === totalPages}
          label="Last page"
        >
          »
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  children,
  label,
  disabled = false,
  current = false,
}: {
  href: string;
  children: ReactNode;
  label: string;
  disabled?: boolean;
  current?: boolean;
}) {
  const cls = [
    "inline-flex h-9 min-w-9 items-center justify-center rounded border px-2.5 text-sm tabular-nums transition-colors",
    current
      ? "border-accent/40 bg-accent/10 font-semibold text-accent"
      : "border-border-strong text-text hover:bg-surface-2",
    disabled ? "pointer-events-none opacity-40" : "",
  ].join(" ");

  if (disabled) {
    return (
      <span role="link" aria-disabled="true" aria-label={label} className={cls}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={cls}
    >
      {children}
    </Link>
  );
}

export function DecodeWarn({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning"
      title="This row could not be decoded by the explorer."
    >
      Partial decode
    </span>
  );
}
