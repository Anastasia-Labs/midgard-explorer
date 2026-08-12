/**
 * A short-lived in-process cache for the handful of routes that do real work
 * per request: metrics runs 13 database queries, and the asset scan decodes up
 * to 20,000 UTxOs. Without this, request rate and server work are the same
 * number, which is what makes those routes an amplifier.
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

const entries = new Map<string, Entry>();

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

/** Tests only. Production has no reason to drop a window early. */
export function clearCache(): void {
  entries.clear();
}
