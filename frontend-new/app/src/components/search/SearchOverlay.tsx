"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EntityIcon } from "../ui/entity";
import { Icon } from "../ui/icons";
import { MIN_PREFIX, isPrefixQuery, searchCandidates, type Candidate } from "../../lib/search";
import { cn, truncateId } from "../../lib/format";

const RECENT_KEY = "mg_recent_searches";
const RECENT_MAX = 5;

/** A partial-identifier match from the backend's prefix search. */
type PrefixHit =
  | { kind: "transaction"; txId: string; height: number | null; headerHash: string | null }
  | { kind: "block"; headerHash: string; height: number };

/** One array, so "no suggestions" is referentially stable across renders. */
const EMPTY_HITS: PrefixHit[] = [];

const hitCandidate = (hit: PrefixHit): Candidate =>
  hit.kind === "block"
    ? {
        kind: "block",
        label: `Block #${hit.height}`,
        detail: truncateId(hit.headerHash, 12, 8),
        href: `/block/${hit.headerHash}`,
      }
    : {
        kind: "transaction",
        label: "Transaction",
        detail:
          hit.height === null
            ? truncateId(hit.txId, 12, 8)
            : `${truncateId(hit.txId, 12, 8)} in block #${hit.height}`,
        href: `/transaction/${hit.txId}`,
      };

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

/** The overview leads with the hero search, so the header's copy of the same
 * control is suppressed there rather than shown twice on one screen. The width
 * lives here rather than in the header, so the null case leaves no empty gap in
 * the layout. */
export function HeaderSearchBox() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <div className="hidden w-40 lg:block">
      <SearchBox variant="header" />
    </div>
  );
}

export function SearchBox({ variant }: { variant: SearchVariant }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  /* The answer is stored with the question it answers.
   *
   * Keeping `hits` and `searching` as separate state meant the effect had to
   * blank them on every keystroke before starting the next query, which is a
   * synchronous write from an effect body and shows as one render of the
   * previous query's suggestions under the new query's text. Tagging the
   * result makes both derivable: anything that does not answer the current
   * query is simply not this query's answer yet. */
  const [answer, setAnswer] = useState<{ query: string; hits: PrefixHit[] } | null>(null);

  const raw = value.trim();
  const prefixQuery = isPrefixQuery(raw);
  const hits = prefixQuery && answer?.query === raw ? answer.hits : EMPTY_HITS;
  const searching = prefixQuery && answer?.query !== raw;

  const result = value.trim() === "" ? null : searchCandidates(value);
  const candidates = result?.ok ? result.candidates : [];

  // A partial identifier is looked up as a prefix, debounced so typing does not
  // fire a query per keystroke. Failures are silent: an absent suggestion is
  // not worth an error message while someone is mid-word, and an empty answer
  // still resolves the query so the reader stops seeing "searching".
  useEffect(() => {
    if (!prefixQuery) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(raw)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((body: { hits?: PrefixHit[] }) => setAnswer({ query: raw, hits: body.hits ?? [] }))
        .catch(() => {
          // An abort is this effect being replaced, not a failed lookup. The
          // query it was asking about is no longer the one on screen.
          if (controller.signal.aborted) return;
          setAnswer({ query: raw, hits: [] });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [prefixQuery, raw]);

  const open = useCallback(() => {
    setReason(null);
    setValue("");
    // No `setHits` any more: clearing the value clears the suggestions,
    // because they are derived from the query they answered.
    setRecent(readRecent());
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);

  // The shortcut binds to whichever variant is the page's primary search box:
  // the hero on the overview, the header everywhere else. HeaderSearchBox keeps
  // those mutually exclusive, so only one listener is ever mounted.
  useEffect(() => {
    if (variant === "icon") return;
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

  const remember = (raw: string) => {
    const trimmed = raw.trim();
    try {
      const next = [trimmed, ...readRecent().filter((r) => r !== trimmed)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: recent searches are best-effort */
    }
  };

  const go = (raw: string, href: string, external?: boolean) => {
    remember(raw);
    dialogRef.current?.close();
    if (external) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    router.push(href);
  };

  /** Enter takes the first candidate, so an unambiguous input is still one
   * keystroke. Ambiguous inputs are listed and the reader picks. */
  const submit = (raw: string) => {
    const r = searchCandidates(raw);
    if (!r.ok) {
      setReason(r.reason);
      return;
    }
    const first = r.candidates[0] ?? (hits.length > 0 ? hitCandidate(hits[0]!) : undefined);
    if (!first) {
      setReason(
        searching
          ? "Still looking for identifiers starting with that."
          : "Nothing on this network starts with that.",
      );
      return;
    }
    go(raw, first.href, first.external);
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
            "flex w-full items-center gap-2.5 rounded-lg border border-border text-left text-text-3 transition-colors hover:border-border-strong hover:text-text-2",
            variant === "hero"
              ? "bg-(--mg-hero-search-bg) px-4 py-2.5 text-[15px] shadow-(--mg-shadow)"
              : "bg-surface-2/60 px-3 py-1.5 text-sm",
          )}
        >
          <Icon name="search" size={variant === "hero" ? 17 : 15} />
          {/* The hero has room to say what is searchable. The header trigger is
              compact, and the overlay's placeholder and hint line answer the
              same question as soon as it opens. */}
          <span className="flex-1 truncate">
            {/* Names what the classifier actually resolves, trimmed to what
                fits the trigger without truncating. Block heights and the
                truncated-prefix case are named by the overlay's own
                placeholder as soon as it opens. */}
            {variant === "hero" ? "Search address, transaction, block or asset" : "Search"}
          </span>
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

          <div className="flex items-center gap-2.5 rounded-lg border border-border-strong bg-(--mg-control-bg) px-3 py-2 focus-within:border-accent">
            <Icon name="search" size={16} className="text-text-3" />
            <input
              id={`universal-search-${variant}`}
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setReason(null);
              }}
              placeholder="Hash, height, address, asset1…, or a hash prefix"
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

          <p className="mt-2 mg-caption text-text-3">
            Transaction or block hash · block height · bech32 address · asset fingerprint (
            <span className="font-mono">asset1…</span>) · or the first {MIN_PREFIX}+ characters of a
            hash
          </p>

          {reason !== null ? (
            <p role="alert" className="mt-2 text-sm text-warning">
              {reason}
            </p>
          ) : null}

          {/* An ambiguous input is listed rather than guessed at. 56 hex is a
              block header hash and equally a minting policy; choosing one
              silently would send a reader to a 404 and leave them believing
              the record does not exist. */}
          {candidates.length > 0 ? (
            <div className="mt-3" data-region="search-candidates">
              <p className="mg-overline">
                {result?.ok && result.ambiguous ? "Matches more than one record" : "Open"}
              </p>
              <ul className="mt-1 space-y-1">
                {candidates.map((c) => (
                  <li key={`${c.kind}-${c.href}`}>
                    <button
                      type="button"
                      onClick={() => go(value, c.href, c.external)}
                      className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-surface-2"
                    >
                      <span className="min-w-0">
                        {/* The type is the whole question an ambiguous input
                            asks, so it gets the glyph and the colour as well as
                            the word. The word stays `c.label`, which is the
                            candidate's own contextual name ("Minting policy",
                            "Block #40") and says more than the generic type
                            name would. `blockHeight` is a way of naming a
                            block, not a separate kind of record. */}
                        <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                          <EntityIcon
                            kind={c.kind === "blockHeight" ? "block" : c.kind}
                            size={14}
                          />
                          {c.label}
                        </span>
                        <span className="block mg-micro text-text-3">{c.detail}</span>
                      </span>
                      <Icon
                        name={c.external ? "external" : "arrowRight"}
                        size={14}
                        className="shrink-0 text-text-3"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {isPrefixQuery(value) ? (
            <div className="mt-3" data-region="search-prefix">
              <p className="mg-overline">
                Starting with <span className="font-mono normal-case">{value.trim()}</span>
              </p>
              {searching ? (
                <p className="mt-1 px-2 py-1.5 mg-caption text-text-3">Searching…</p>
              ) : hits.length === 0 ? (
                <p className="mt-1 px-2 py-1.5 mg-caption text-text-3">
                  Nothing on this network starts with that.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {hits.map((hit) => {
                    const c = hitCandidate(hit);
                    return (
                      <li key={c.href}>
                        <button
                          type="button"
                          onClick={() => go(value, c.href)}
                          className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-surface-2"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-text">{c.label}</span>
                            <span className="block font-mono mg-micro text-text-3">{c.detail}</span>
                          </span>
                          <Icon name="arrowRight" size={14} className="shrink-0 text-text-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
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
                  className="h-8 rounded px-2 mg-caption text-text-3 hover:text-text"
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
