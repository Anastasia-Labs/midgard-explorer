"use client";

import { useState } from "react";
import { Icon } from "../../components/ui/icons";
import { GLOSSARY, type GlossaryEntry, type GlossaryTerm } from "../../lib/glossary";

const CATEGORIES: readonly GlossaryEntry["category"][] = [
  "Ledger",
  "Transaction",
  "Script",
  "Asset",
  "Explorer",
];

const MAX_QUERY_LENGTH = 120;

/** One derived index over the shared glossary.
 *
 * Definitions still have one owner in `lib/glossary.ts`: this component only
 * adds discovery and stable fragment identifiers. The query is compared as
 * plain text and is never interpolated into markup, a selector, or a request.
 */
const ENTRIES = (
  Object.entries(GLOSSARY) as Array<[GlossaryTerm, (typeof GLOSSARY)[GlossaryTerm]]>
).map(([term, entry]) => ({ term, entry }));

const categoryId = (category: GlossaryEntry["category"]) =>
  `glossary-category-${category.toLowerCase()}`;

const termId = (term: GlossaryTerm) => `glossary-term-${term}`;

export function GlossaryIndex() {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("en-US");
  const visible =
    normalized.length === 0
      ? ENTRIES
      : ENTRIES.filter(({ entry }) =>
          [entry.label, entry.category, entry.meaning, entry.consequence]
            .join(" ")
            .toLocaleLowerCase("en-US")
            .includes(normalized),
        );
  const groups = CATEGORIES.map((category) => ({
    category,
    entries: visible.filter(({ entry }) => entry.category === category),
  })).filter(({ entries }) => entries.length > 0);
  const resultText = `${visible.length} ${visible.length === 1 ? "term" : "terms"}${
    normalized.length > 0 ? ` matching “${query.trim()}”` : ` across ${groups.length} categories`
  }`;

  return (
    <>
      <div className="mb-5 rounded-lg border border-border bg-surface p-4 shadow-(--mg-shadow)">
        <form
          role="search"
          onSubmit={(event) => event.preventDefault()}
          className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
        >
          <div className="w-full max-w-xl">
            <label
              htmlFor="glossary-search"
              className="mb-1.5 block text-sm font-semibold text-text"
            >
              Search glossary
            </label>
            <div className="relative">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-3"
              />
              <input
                id="glossary-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value.slice(0, MAX_QUERY_LENGTH))}
                maxLength={MAX_QUERY_LENGTH}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="glossary-results"
                placeholder="Search terms and definitions"
                className="h-10 w-full rounded-md border border-border-strong bg-surface-2 pr-10 pl-9 text-sm text-text placeholder:text-text-3"
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear glossary search"
                  className="absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded text-text-3 transition-colors hover:bg-surface-3 hover:text-text"
                >
                  <Icon name="x" size={15} />
                </button>
              ) : null}
            </div>
          </div>
          <p
            id="glossary-results"
            role="status"
            aria-live="polite"
            className="mg-caption text-text-3"
          >
            {resultText}
          </p>
        </form>

        {groups.length > 0 ? (
          <nav aria-label="Glossary categories" className="mt-4 border-t border-border pt-3">
            <ul className="flex flex-wrap gap-2">
              {groups.map(({ category, entries }) => (
                <li key={category}>
                  <a
                    href={`#${categoryId(category)}`}
                    aria-label={`${category}, ${entries.length} ${entries.length === 1 ? "term" : "terms"}`}
                    className="inline-flex min-h-9 items-center rounded-full border border-border-strong px-3 text-sm text-text-2 transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-text"
                  >
                    {category}
                    <span className="ml-1.5 tabular-nums text-text-3">{entries.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center">
          <p className="font-display text-lg font-semibold text-text">No matching terms</p>
          <p className="mt-1 mg-caption text-text-3">
            Try a protocol concept, field label, or consequence such as “finality” or “fee”.
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-4 inline-flex min-h-10 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-text hover:bg-surface-2"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {groups.map(({ category, entries }) => (
            <section
              key={category}
              id={categoryId(category)}
              aria-labelledby={`${categoryId(category)}-title`}
              className="scroll-mt-24 grid gap-3 py-6 lg:grid-cols-[12rem_1fr]"
            >
              <h2
                id={`${categoryId(category)}-title`}
                className="font-display text-xl font-semibold text-page-title"
              >
                {category}
              </h2>
              <dl className="divide-y divide-border">
                {entries.map(({ term, entry }) => (
                  <div
                    key={term}
                    id={termId(term)}
                    className="scroll-mt-24 grid gap-1 py-3 first:pt-0 last:pb-0 target:rounded-md target:bg-accent/5 target:px-2 sm:grid-cols-[11rem_1fr] sm:gap-5"
                  >
                    <dt className="text-sm font-semibold text-text">
                      <a
                        href={`#${termId(term)}`}
                        className="rounded-sm hover:text-link hover:underline"
                      >
                        {entry.label}
                      </a>
                    </dt>
                    <dd className="text-sm leading-relaxed text-text-2">
                      {entry.meaning} {entry.consequence}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
