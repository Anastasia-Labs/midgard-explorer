"use client";

import { useState } from "react";
import type { GlossaryTerm } from "../../lib/glossary";
import type { SemanticIconKind } from "../../lib/semantic-icons";
import { cn } from "../../lib/format";
import { FieldLabel } from "./infotip";
import { Icon } from "./icons";
import { SemanticLabel } from "./semantic";

export function JsonPanel({
  title,
  value,
  variant = "compact",
  filename,
  term,
  semantic,
}: {
  title: string;
  value: unknown;
  variant?: "compact" | "full";
  filename?: string;
  term?: GlossaryTerm;
  semantic?: SemanticIconKind;
}) {
  const json = JSON.stringify(value, null, 2) ?? "null";
  const [copied, setCopied] = useState(false);
  const full = variant === "full";

  return (
    <section
      className={cn(
        "overflow-hidden",
        full ? "rounded-lg border border-border bg-surface" : "border-t border-border",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2",
          full ? "border-b border-border px-4 py-3" : "px-0 py-2",
        )}
      >
        <h2
          className={full ? "text-body font-semibold text-text" : "text-sm font-semibold text-text"}
        >
          {semantic ? (
            <SemanticLabel kind={semantic} label={title} />
          ) : (
            <FieldLabel label={title} term={term} />
          )}
        </h2>
        {full ? (
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Copy JSON"
              onClick={() => {
                void navigator.clipboard.writeText(json).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1_500);
                });
              }}
              className="inline-flex size-9 items-center justify-center rounded text-text-3 hover:bg-surface-2 hover:text-text"
            >
              <Icon name={copied ? "check" : "copy"} size={15} />
            </button>
            {filename ? (
              <a
                href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
                download={filename}
                aria-label="Download JSON"
                className="inline-flex size-9 items-center justify-center rounded text-text-3 hover:bg-surface-2 hover:text-text"
              >
                <Icon name="download" size={15} />
              </a>
            ) : null}
            <span aria-live="polite" className="sr-only">
              {copied ? "JSON copied to clipboard" : ""}
            </span>
          </div>
        ) : null}
      </div>
      <pre
        tabIndex={0}
        role="region"
        aria-label={full ? `${title} body` : title}
        className={cn(
          "overflow-auto font-mono text-xs leading-relaxed",
          full ? "max-h-128 p-4" : "max-h-56 px-0 py-3",
        )}
      >
        {json}
      </pre>
    </section>
  );
}
