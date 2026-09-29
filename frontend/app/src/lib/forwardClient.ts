/** Forward only the nearest edge's client address. The deployment must strip
 * incoming forwarding headers before traffic reaches Next.js and prevent
 * direct access to a frontend trusted by the backend. A header alone cannot
 * establish trust in the sender. */
type HeaderSource = { get(name: string): string | null };

export function forwardedFrom(source: HeaderSource): Record<string, string> {
  // `x-real-ip` is dropped: the backend reads one header, and accepting a
  // second spelling gave a client a way to state an identity the edge never
  // wrote.
  const chain = source.get("x-forwarded-for");
  if (chain === null) return {};
  const entries = chain
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  // Only the last entry is forwarded on. Everything to its left was supplied
  // by something further from the edge, which means it may have been supplied
  // by the client.
  const nearest = entries.at(-1);
  return nearest === undefined ? {} : { "x-forwarded-for": nearest };
}

export function forwardedForHeader(request: Request): Record<string, string> {
  return forwardedFrom(request.headers);
}

/**
 * The benchmark's cache-bypass header, passed through when a request carries it.
 *
 * The overview route calls six backend routes, and a benchmark measuring it
 * cold must reach them cold too, or it measures the backend's response cache.
 * Forwarding it grants nothing: the backend has no bypass unless it was started
 * with a benchmark token, and then only a request carrying that secret skips a
 * cache.
 */
export function benchBypassHeader(request: Request): Record<string, string> {
  const token = request.headers.get("x-explorer-bench-bypass");
  return token === null ? {} : { "x-explorer-bench-bypass": token };
}
