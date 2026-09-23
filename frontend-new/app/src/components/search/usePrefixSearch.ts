"use client";

import { useEffect, useState } from "react";
import { EMPTY_HITS, type PrefixHit } from "./hits";

/**
 * Looking up a partial identifier while somebody is still typing it.
 *
 * The answer is stored with the question it answers. Keeping `hits` and
 * `searching` as separate state meant blanking them on every keystroke before
 * starting the next query, which is a synchronous write from an effect body and
 * shows as one render of the previous query's suggestions under the new query's
 * text. Tagging the result makes both derivable: anything that does not answer
 * the current query is simply not this query's answer yet.
 */

/** Whether a query is the kind the prefix endpoint can answer. Asset
 * fingerprints are excluded: they are resolved locally, not by prefix. */
export const isLookupQuery = (raw: string): boolean =>
  (/^[0-9a-fA-F]{6,}$/.test(raw) || /^(?:addr|stake)(?:_test)?1[0-9a-z]+$/.test(raw)) &&
  !raw.toLowerCase().startsWith("asset1");

export function usePrefixSearch(raw: string): { hits: PrefixHit[]; searching: boolean } {
  const [answer, setAnswer] = useState<{ query: string; hits: PrefixHit[] } | null>(null);
  const lookup = isLookupQuery(raw);

  // Debounced, so typing does not fire a query per keystroke. Failures are
  // silent: an absent suggestion is not worth an error message while somebody
  // is mid-word, and an empty answer still resolves the query so the reader
  // stops seeing "searching".
  useEffect(() => {
    if (!lookup) return;
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
  }, [lookup, raw]);

  return {
    hits: lookup && answer?.query === raw ? answer.hits : EMPTY_HITS,
    searching: lookup && answer?.query !== raw,
  };
}
