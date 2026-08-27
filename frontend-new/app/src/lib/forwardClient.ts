/**
 * The client address to pass through to the backend.
 *
 * No browser fetch in this app reaches the backend directly: a route handler or
 * a server component fetches on the viewer's behalf. Without this the backend
 * sees this server's address on every one of them, and its per-client rate
 * limiter would put every viewer in the world into one bucket. The first
 * symptom would be readers getting 429 for someone else's traffic.
 *
 * The value is only ever the one the trusted edge wrote. This used to copy
 * whatever the caller sent, so a direct client could supply its own chain,
 * rotate it per request, evade the limiter entirely and fill its bucket map
 * with forged identities. The backend counts hops from the right for the same
 * reason: the rightmost entry is the one the nearest trusted hop wrote, and it
 * is the only part a client cannot choose.
 */
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
