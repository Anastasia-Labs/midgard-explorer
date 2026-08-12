/**
 * The client address to pass through to the backend.
 *
 * No browser fetch in this app reaches the backend directly: a route handler or
 * a server component fetches on the viewer's behalf. Without this the backend
 * sees this server's address on every one of them, and its per-client rate
 * limiter would put every viewer in the world into one bucket. The first
 * symptom would be readers getting 429 for someone else's traffic.
 *
 * Appends rather than replaces: `x-forwarded-for` is a chain, and a proxy in
 * front of this one has already written the parts it knows.
 */
type HeaderSource = { get(name: string): string | null };

export function forwardedFrom(source: HeaderSource): Record<string, string> {
  const existing = source.get("x-forwarded-for");
  const real = source.get("x-real-ip");
  const chain = existing ?? real;
  return chain ? { "x-forwarded-for": chain } : {};
}

export function forwardedForHeader(request: Request): Record<string, string> {
  return forwardedFrom(request.headers);
}
