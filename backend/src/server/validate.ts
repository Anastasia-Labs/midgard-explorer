import { isHexOfLength } from "../utils";

/**
 * Request-parameter checks, defined once.
 *
 * Six routes parsed a page parameter and repeated the same four lines to do
 * it. Three then repeated a hex check that `isHexOfLength` already expressed,
 * and `l1.ts` wrote the same check a third time as raw regexes.
 *
 * `/api/l1/transactions/:page` is deliberately not one of these. Its file
 * states the ruling: a page number there is a navigation hint and a bad one is
 * coerced to the first page, because there is no wrong resource to serve. Only
 * the identifier half of that ruling is shared, through `parseHexOfLength`.
 *
 * A result type rather than a throw: a route returns its own 400 with the
 * message it wants, and nothing here knows what an Express response is.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (error: string): Parsed<never> => ({ ok: false, error });

/**
 * A 1-based page from a route parameter.
 *
 * Integers only. `Number("2.5")` is finite and greater than 1, so it passed
 * every previous check, and the database helpers then floored it: `/2.5`
 * served page 2 while reporting nothing. A fractional page is a caller's
 * mistake, so it is answered rather than rounded.
 */
export const parsePageParam = (raw: unknown): Parsed<number> => {
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) return bad("Invalid page.");
  return ok(page);
};

/**
 * A 1-based page from a query string, where absent means the first page.
 *
 * `/api/address?address=…` pages this way rather than by route segment, so the
 * missing case is a default and not an error.
 */
export const parsePageQuery = (raw: unknown): Parsed<number> => {
  if (raw === undefined || raw === "") return ok(1);
  return parsePageParam(raw);
};

/**
 * The optional `?id=` filter the bridge listings accept, lower-cased.
 *
 * Absent and present-but-empty are both absent: `?id=` is how a filter gets
 * cleared, and it is not a request for the empty identifier.
 */
export const parseOptionalHexQuery = (raw: unknown): Parsed<string | undefined> => {
  if (typeof raw !== "string" || raw === "") return ok(undefined);
  const id = raw.toLowerCase();
  if (!/^[0-9a-f]+$/.test(id)) return bad("id must be hexadecimal.");
  return ok(id);
};

/** A hash of an exact length, named in the message so the caller knows which
 * field was wrong. */
export const parseHexOfLength = (
  raw: unknown,
  length: number,
  field: string,
): Parsed<string> => {
  const value = String(raw ?? "").toLowerCase();
  if (!isHexOfLength(value, length)) {
    return bad(`${field} must be ${length} hex characters.`);
  }
  return ok(value);
};
