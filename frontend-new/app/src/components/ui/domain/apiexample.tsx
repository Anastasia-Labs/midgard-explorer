"use client";

import { useState } from "react";
import { PUBLIC_API_BASE } from "../../../lib/env";
import { SemanticLabel } from "../base/semantic";

/** The exact call that produced this page.
 *
 * Every record here is served by one public endpoint, and showing it turns a
 * page from something to read into something to build against. It is the
 * request that was actually made, not an illustrative one: a documented
 * endpoint that differs from the one in use is worse than no documentation.
 */
export function ApiExample({ path, note }: { path: string; note?: string }) {
  const url = `${PUBLIC_API_BASE}${path}`;
  const curl = `curl -s '${url}'`;
  const [copied, setCopied] = useState<"url" | "curl" | null>(null);

  const copy = (text: string, which: "url" | "curl") => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-body font-semibold text-text">
          <SemanticLabel kind="api" label="API" />
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => copy(url, "url")}
            className="inline-flex h-9 items-center rounded border border-border-strong px-2.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text"
          >
            {copied === "url" ? "Copied" : "Copy URL"}
          </button>
          <button
            type="button"
            onClick={() => copy(curl, "curl")}
            className="inline-flex h-9 items-center rounded border border-border-strong px-2.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text"
          >
            {copied === "curl" ? "Copied" : "Copy curl"}
          </button>
        </div>
      </div>
      {/* A scrollable region a mouse can pan but a keyboard cannot reach is a
          WCAG 2.1.1 failure. The command overflows only on a narrow viewport,
          which is why this went unnoticed until the Raw tab was audited at
          mobile width. */}
      <pre
        tabIndex={0}
        role="region"
        aria-label="Example request"
        className="overflow-x-auto p-4 font-mono text-xs leading-relaxed wrap-anywhere"
      >
        {curl}
      </pre>
      {note ? (
        <p className="border-t border-border px-4 py-2.5 mg-micro text-text-3">{note}</p>
      ) : null}
    </section>
  );
}
