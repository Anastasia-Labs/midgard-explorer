/**
 * The last few things this browser searched for.
 *
 * Per-viewer convenience, kept in localStorage, and read defensively: a value
 * written by an older version, or by something else entirely, must not stop the
 * search box from opening.
 */

const RECENT_KEY = "mg_recent_searches";
const RECENT_MAX = 5;

export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Forgets every remembered query. */
export function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // A browser refusing storage has nothing to forget.
  }
}

/** Puts one query at the front, without growing past the cap. */
export function rememberSearch(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed === "") return readRecent();
  const next = [trimmed, ...readRecent().filter((entry) => entry !== trimmed)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A browser refusing storage is not a reason to fail a search.
  }
  return next;
}
