import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

/**
 * Short-lived in-process caches for work and public JSON responses. Metrics
 * runs 13 database queries, and the asset scan decodes up to 20,000 UTxOs.
 * Without this, request rate and server work are the same number, which is what
 * makes those routes an amplifier.
 *
 * In-process on purpose. The explorer runs as one process against one node, so
 * a shared cache would add an invalidation protocol and a dependency to solve a
 * problem this deployment does not have. If it ever runs as several processes,
 * the worst case is each holding its own copy for a few seconds.
 *
 * The window is short by design. These figures move with the chain, and a
 * reader refreshing the overview should see the node's current state, not a
 * snapshot from a minute ago.
 */

type Entry = { expiresAt: number; value: Promise<unknown> };
type ResponseEntry = {
  expiresAt: number;
  createdAt: number;
  body: unknown;
  /** What this response weighed on the wire. Counting bytes rather than
   * entries is the difference between a bounded cache and a bounded-looking
   * one: a single-transaction response carries up to 64KB of inline CBOR, so a
   * thousand of them is about a hundred megabytes. */
  bytes: number;
};

const entries = new Map<string, Entry>();
const responses = new Map<string, ResponseEntry>();
let cachedBytes = 0;

/**
 * Benchmark-only cache bypass.
 *
 * Every `/api/` route carries a five-second response cache, so a benchmark
 * repeating one path measures the cache rather than the query. A `cold`
 * database budget resting on a warm reading is not a weak measurement, it is
 * the wrong one.
 *
 * Gated on a **secret**, not a bare header. Without `BENCH_CACHE_BYPASS_TOKEN`
 * set, this code path does not exist: `bypassToken` stays null and every
 * request is cached exactly as before. With it set, only a request presenting
 * the matching token skips the cache. A bare header would let any client
 * disable caching on a public deployment and turn the amplification these
 * caches exist to prevent into a denial of service.
 */
const BYPASS_HEADER = "x-explorer-bench-bypass";
let bypassToken: string | null = null;

/** Called once at startup. A blank or absent token leaves the bypass off. */
export function configureBenchBypass(token: string | null | undefined): void {
  bypassToken = token && token.length >= 16 ? token : null;
}

/**
 * Carries the bypass decision to the inner work cache.
 *
 * `AsyncLocalStorage`, not a module-level flag. The inner `cached(...)` wrapper
 * has no access to the request, and a shared flag would leak: at concurrency 32
 * one bypassed request in flight would make every other request skip the work
 * cache too, so a warm-cache budget would silently measure cold work. The store
 * is per async context, so each request sees only its own decision.
 */
const bypassStore = new AsyncLocalStorage<boolean>();

/** True only when a bypass is configured and this request presents it. */
function bypassed(req: { headers: Record<string, unknown> }): boolean {
  if (bypassToken === null) return false;
  const presented = req.headers[BYPASS_HEADER];
  return typeof presented === "string" && presented === bypassToken;
}

/** Whether the bypass is configured at all. For readiness to report it. */
export function benchBypassEnabled(): boolean {
  return bypassToken !== null;
}

function drop(key: string): void {
  const entry = responses.get(key);
  if (!entry) return;
  cachedBytes -= entry.bytes;
  responses.delete(key);
}

/**
 * Wraps `work` so calls within `ttlMs` of the first share one result.
 *
 * The PROMISE is stored rather than the resolved value, so a burst of callers
 * arriving before the first finishes all wait on the same run instead of each
 * starting their own. A rejected promise is evicted, because caching a
 * transient database error would keep it alive long after the cause cleared.
 */
export function cached<A>(
  key: string,
  ttlMs: number,
  work: () => Promise<A>,
): () => Promise<A> {
  return () => {
    // The inner work cache needs the same bypass as the response cache.
    // `/api/metrics` and `/api/assets` have both, so bypassing only the outer
    // one still measures a cached reading.
    if (bypassStore.getStore() === true) return work();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as Promise<A>;

    const value = work();
    entries.set(key, { expiresAt: Date.now() + ttlMs, value });
    void value.catch(() => {
      // Only evict if this run is still the cached one: a later run may have
      // already replaced it.
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  };
}

/** Cache successful public GET responses and emit shared-cache policy for the
 * reverse proxy/CDN. The map is bounded globally, not once per route, so a
 * crawler varying query strings cannot grow process memory without limit. */
export function cachePublicJson(
  ttlMs: number,
  maxEntries: number,
  maxBytes: number,
): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET" || ttlMs <= 0) return next();
    if (bypassed(req)) {
      // Neither read nor written: a benchmark run must not warm the cache for
      // the requests that follow it either.
      res.setHeader("X-Explorer-Cache", "BYPASS");
      return bypassStore.run(true, () => next());
    }

    const now = Date.now();
    const key = req.originalUrl;
    const hit = responses.get(key);
    if (hit && hit.expiresAt > now) {
      // Refresh insertion order so eviction is least-recently-used.
      responses.delete(key);
      responses.set(key, hit);
      res.setHeader("Age", String(Math.floor((now - hit.createdAt) / 1_000)));
      res.setHeader("X-Explorer-Cache", "HIT");
      setSharedCacheHeaders(res, ttlMs);
      return res.status(200).json(hit.body);
    }
    if (hit) drop(key);

    res.setHeader("X-Explorer-Cache", "MISS");
    setSharedCacheHeaders(res, ttlMs);
    const sendJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode === 200) {
        const entry: ResponseEntry = {
          expiresAt: Date.now() + ttlMs,
          createdAt: Date.now(),
          body,
          bytes: 0,
        };
        responses.set(key, entry);
        const sent = sendJson(body);
        // Measured after the send, from what Express actually wrote, so the
        // budget counts the bytes a reader received rather than an estimate of
        // them and never serializes the body a second time to find out.
        const length = Number(res.getHeader("Content-Length") ?? 0);
        entry.bytes = Number.isFinite(length) ? length : 0;
        cachedBytes += entry.bytes;
        // `responses.size > 1` kept one entry no matter how large it was, so a
        // single response bigger than the whole budget stayed cached forever
        // and the ceiling it was measured against did nothing. Evicting down to
        // empty is correct: an entry that cannot fit the budget must not be
        // held, and the next request simply misses.
        while (
          responses.size > 0 &&
          (responses.size > maxEntries || cachedBytes > maxBytes)
        ) {
          const oldest = responses.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          drop(oldest);
        }
        return sent;
      } else {
        // Never let a CDN retain a transient error under the success policy
        // installed before the handler ran.
        res.setHeader("Cache-Control", "no-store");
        res.removeHeader("X-Accel-Expires");
      }
      return sendJson(body);
    }) as typeof res.json;
    return next();
  };
}

function setSharedCacheHeaders(
  res: Parameters<RequestHandler>[1],
  ttlMs: number,
): void {
  const seconds = Math.max(1, Math.ceil(ttlMs / 1_000));
  // Browsers revalidate. Shared caches may serve and coalesce the short-lived
  // response; X-Accel-Expires gives the bundled Nginx cache an exact TTL.
  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds}`,
  );
  res.setHeader("X-Accel-Expires", String(seconds));
}

/** Tests only. Production has no reason to drop a window early. */
export function clearCache(): void {
  entries.clear();
  responses.clear();
  cachedBytes = 0;
}
