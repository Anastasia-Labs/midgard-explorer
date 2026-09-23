"use client";

import { useState } from "react";
import type { GlossaryTerm } from "../../../lib/glossary";
import type { SemanticIconKind } from "../../../lib/semantic-icons";
import { cn } from "../../../lib/format";
import { FieldLabel } from "./infotip";
import { Icon } from "./icons";
import { SemanticLabel } from "./semantic";

/** A value longer than this gets its own wrapped block under its key. */
export const LONG_VALUE = 96;

const LONG_LINE = new RegExp(`^(\\s*)("(?:[^"\\\\]|\\\\.)*":\\s)?("[^"]{${LONG_VALUE},}",?)$`);

/** The JSON, one line per line, with a long string value moved onto its own
 * wrapped block, indented under its key.
 *
 * The characters are exactly the response's: only how they wrap on screen
 * changes, so selecting the text still copies the whole value. A single CBOR
 * string used to be one line thousands of characters wide. */
function JsonLines({ json }: { json: string }) {
  return (
    <>
      {json.split("\n").map((line, i) => {
        const match = LONG_LINE.exec(line);
        if (!match)
          return (
            <span key={i}>
              {line}
              {"\n"}
            </span>
          );
        const [, indent = "", key = "", value = ""] = match;
        return (
          <span key={i}>
            {indent}
            {key}
            <span className="block break-all" style={{ paddingLeft: `${indent.length + 2}ch` }}>
              {value}
            </span>
          </span>
        );
      })}
    </>
  );
}

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
  const full = variant === "full";
  const json = JSON.stringify(value, null, 2) ?? "null";
  const [copied, setCopied] = useState(false);

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
          // Wraps rather than scrolling sideways: one long value used to push
          // the whole panel wider than a laptop screen.
          "overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]",
          full ? "max-h-128 p-4" : "max-h-56 px-0 py-3",
        )}
      >
        <JsonLines json={json} />
      </pre>
    </section>
  );
}
