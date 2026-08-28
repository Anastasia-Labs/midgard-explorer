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
