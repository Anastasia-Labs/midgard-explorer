import { canonicalHash, isHexOfLength } from "../utils";

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
 * The deepest a single offset-paginated request may scan, in rows.
 *
 * Every list route answers page N by telling PostgreSQL to produce N x
 * pageSize rows and discard all but the last page of them, so the work grows
 * with the page number while the response does not. Nothing bounded that: the
 * address route accepted `?page=999999999` and computed `OFFSET 24999999975`,
 * held for as long as `DB_STATEMENT_TIMEOUT_MS` allowed, against a pool of
 * eight connections and a rate limit that admits 120 requests a minute.
 *
 * Expressed in rows rather than pages because the page size is not one number:
 * `BLOCKS_PER_PAGE` and `TRANSACTIONS_PER_PAGE` are configurable, and the
 * others are 25. A rows bound means the same amount of work is allowed
 * wherever it is applied, whatever a deployment has configured.
 *
 * 100,000 is above every dataset this repository models or serves and far
 * below where the work becomes a denial of service. The `stress` benchmark
 * profile, the largest modelled, is 50,000 blocks: its whole blocks list is
 * 2,000 pages. The number is a bound on work per request, not a claim about
 * how much data exists, and it is not the answer to genuinely deep access.
 * That is cursor pagination, which the register carries as `CURSOR-PAGINATION`
 * and which would replace this rather than raise it.
 */
export const MAX_PAGE_OFFSET_ROWS = 100_000;

/** The last page a route with this page size will serve. */
export const maxPageFor = (pageSize: number): number =>
  Math.max(1, Math.floor(MAX_PAGE_OFFSET_ROWS / pageSize));

/**
 * A 1-based page from a route parameter, bounded by what it would cost.
 *
 * Integers only. `Number("2.5")` is finite and greater than 1, so it passed
 * every previous check, and the database helpers then floored it: `/2.5`
 * served page 2 while reporting nothing. A fractional page is a caller's
 * mistake, so it is answered rather than rounded.
 *
 * `Number.isInteger` also settles the two inputs that a range check alone
 * would let through: `Infinity` and `NaN` are not integers, so neither reaches
 * the multiplication that turns a page into an offset. Above the bound the
 * answer is 400 and no statement is issued, which is the point: a request that
 * is refused must not first do the work that made it worth refusing.
 */
export const parsePageParam = (raw: unknown, pageSize?: number): Parsed<number> => {
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) return bad("Invalid page.");
  if (pageSize !== undefined) {
    const max = maxPageFor(pageSize);
    if (page > max) return bad(`Page ${page} is past the last page this route serves (${max}).`);
  }
  return ok(page);
};

/**
 * A 1-based page from a query string, where absent means the first page.
 *
 * `/api/address?address=…` pages this way rather than by route segment, so the
 * missing case is a default and not an error.
 */
export const parsePageQuery = (raw: unknown, pageSize?: number): Parsed<number> => {
  if (raw === undefined || raw === "") return ok(1);
  return parsePageParam(raw, pageSize);
};

/**
 * A page number that is a navigation hint, bounded the same way.
 *
 * `/api/l1/activity/:page` coerces a malformed page to the first rather than
 * refusing it: a link with `abc` in it should show the reader something, and
 * there is no wrong resource to serve. That ruling is about MALFORMED input
 * and does not extend to excessive depth, which is a different thing: page
 * 900,000,000 is not a link to repair, it is work to refuse. Coercing it
 * silently would hide the refusal and answer a question nobody asked, so the
 * depth half is explicit here exactly as it is everywhere else.
 */
export const parseHintedPage = (raw: unknown, pageSize: number): Parsed<number> => {
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) return ok(1);
  const max = maxPageFor(pageSize);
  if (page > max) return bad(`Page ${page} is past the last page this route serves (${max}).`);
  return ok(page);
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
  const value = canonicalHash(String(raw ?? ""));
  if (!isHexOfLength(value, length)) {
    return bad(`${field} must be ${length} hex characters.`);
  }
  return ok(value);
};
