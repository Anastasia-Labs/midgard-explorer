"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons";
import { classify, hrefFor } from "../../lib/classify";
import { cn } from "../../lib/format";

const RECENT_KEY = "mg_recent_searches";
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type SearchVariant = "header" | "hero" | "icon";

export function SearchBox({ variant }: { variant: SearchVariant }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  const open = useCallback(() => {
    setReason(null);
    setValue("");
    setRecent(readRecent());
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (variant !== "header") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        open();
        return;
      }
      // "/" is the explorer convention; never steal it while typing.
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, variant]);

  const submit = (raw: string) => {
    const c = classify(raw);
    const href = hrefFor(c);
    if (href === null) {
      setReason(c.kind === "invalid" ? c.reason : null);
      return;
    }
    const trimmed = raw.trim();
    try {
      const next = [trimmed, ...readRecent().filter((r) => r !== trimmed)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: recent searches are best-effort */
    }
    dialogRef.current?.close();
    router.push(href);
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={open}
          aria-label="Search (Ctrl+K)"
          className="flex size-9 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text"
        >
          <Icon name="search" size={18} />
        </button>
      ) : (
        <button
          type="button"
          onClick={open}
          aria-label="Search (Ctrl+K)"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface-2/60 text-left text-text-3 transition-colors hover:border-border-strong hover:text-text-2",
            variant === "hero"
              ? "px-4 py-2.5 text-[15px] shadow-(--mg-shadow)"
              : "px-3 py-1.5 text-sm",
          )}
        >
          <Icon name="search" size={variant === "hero" ? 17 : 15} />
          <span className="flex-1 truncate">Search transactions, blocks, addresses</span>
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-3">
            ⌘K
          </kbd>
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-label="Universal search"
        className="mg-pop m-auto w-full max-w-xl rounded-xl border border-border-strong bg-surface p-0 text-text shadow-lg backdrop:bg-black/50"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current.close();
        }}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
          className="p-4"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="mg-overline">Search</p>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close search"
              className="inline-flex h-9 items-center rounded px-2.5 text-sm text-text-2 hover:bg-surface-2 hover:text-text"
            >
              Close
            </button>
          </div>

          <label htmlFor={`universal-search-${variant}`} className="sr-only">
            Search by transaction hash, block header hash, or address
          </label>

          <div className="flex items-center gap-2.5 rounded-lg border border-border-strong bg-bg px-3 py-2 focus-within:border-accent">
            <Icon name="search" size={16} className="text-text-3" />
            <input
              id={`universal-search-${variant}`}
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setReason(null);
              }}
              placeholder="Tx hash (64 hex) · block hash (56 hex) · address (bech32)"
              className="w-full bg-transparent font-mono text-sm outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            {value !== "" ? (
              <button
                type="button"
                onClick={() => {
                  setValue("");
                  setReason(null);
                  inputRef.current?.focus();
                }}
                aria-label="Clear search input"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded text-text-3 hover:bg-surface-2 hover:text-text"
              >
                ×
              </button>
            ) : null}
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-3">
              ↵
            </kbd>
          </div>

          <p className="mt-2 text-[12.5px] text-text-3">
            Transaction hash (64 hex) · block header hash (56 hex) · bech32 address (
            <span className="font-mono">addr</span> / <span className="font-mono">addr_test</span>)
          </p>

          {reason !== null ? (
            <p role="alert" className="mt-2 text-sm text-warning">
              {reason}
            </p>
          ) : null}

          {recent.length > 0 ? (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <p className="mg-overline">Recent</p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.removeItem(RECENT_KEY);
                    } catch {
                      /* storage unavailable: best-effort */
                    }
                    setRecent([]);
                  }}
                  className="h-8 rounded px-2 text-[12.5px] text-text-3 hover:text-text"
                >
                  Clear
                </button>
              </div>
              <ul className="mt-1 space-y-1">
                {recent.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onClick={() => submit(r)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-sm text-text-2 hover:bg-surface-2"
                    >
                      <Icon name="clock" size={13} className="text-text-3" />
                      <span className="truncate">{r}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      </dialog>
    </>
  );
}
