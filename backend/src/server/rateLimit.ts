import { Application, NextFunction, Request, Response } from "express";
import { rateLimitedPaths } from "./catalogue";

/**
 * A fixed-window request limiter, per client, per limiter instance.
 *
 * In-process for the same reason the response cache is: the explorer runs as
 * one process, so a shared store would add a dependency and a protocol to
 * solve a problem this deployment does not have. Several processes would each
 * enforce their own share of the limit, which is a weaker guarantee but never
 * a wrong answer to a legitimate request.
 *
 * Fixed window rather than a sliding one: at these limits the boundary burst a
 * fixed window permits is not worth the extra state. The point is to stop one
 * client turning a public route into unbounded server work, not to meter
 * precisely.
 *
 * ## Reading the client address correctly matters here
 *
 * Browser traffic to this API arrives through the frontend's own route
 * handlers (`/api/overview`, `/api/search`), so `req.ip` is the frontend
 * server for every one of those requests. Keying on `req.ip` alone would put
 * every viewer in the world into a single bucket, and the first symptom would
 * be readers getting 429 for someone else's traffic.
 *
 * So the proxy forwards the original address in `x-forwarded-for`, and this
 * reads the first entry of that header, but only when the socket's own peer is
 * one of our proxies: loopback or a private network. A forged header can then
 * only ever SPLIT a bucket, never merge two, and only from inside. Read from
 * any peer, it would instead be a free way to leave the bucket behind: rotate
 * the value, keep the budget, and grow the map with every distinct string.
 * Requests with no trusted chain share the per-source bucket for their real
 * address.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** Requests allowed per window, per client. */
  limit: number;
  windowMs: number;
};

/** Whether the peer that opened this socket is one of our own proxies.
 *
 * The frontend's route handlers run beside this API, so a forwarded chain that
 * we should believe always arrives over loopback or a private network. From
 * anywhere else the header is client-settable, and honouring it hands a fresh
 * budget to every forged value while growing the bucket map for free. */
function isTrustedProxy(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (ip === "::1" || ip === "localhost") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique local
  const [a, b] = ip.split(".").map(Number);
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return false;
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** The original client address when one of our proxies forwarded it, else the
 * socket address. `x-forwarded-for` is a comma-separated chain and the first
 * entry is the client. req.ip is undefined when the socket is already gone;
 * those share one bucket, which is correct because they are
 * indistinguishable. */
function clientAddress(req: Request): string {
  const peer = req.ip;
  if (isTrustedProxy(peer)) {
    const forwarded = req.headers?.["x-forwarded-for"];
    const chain = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = chain?.split(",")[0]?.trim();
    if (first && first.length > 0) return first;
  }
  return peer ?? "unknown";
}

let sequence = 0;

export function rateLimiter({ limit, windowMs }: RateLimitOptions) {
  // Each limiter gets its own namespace, so a client's metrics budget and its
  // asset budget are independent.
  const namespace = `rl${(sequence += 1)}`;

  return function limitRequests(req: Request, res: Response, next: NextFunction) {
    const key = `${namespace}:${clientAddress(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many requests.",
        retryAfterSeconds: retryAfter,
      });
    }

    bucket.count += 1;
    return next();
  };
}

/** Which routes do real work per request is a property of the route, so it is
 * declared beside the route in the endpoint catalogue rather than repeated as
 * a list here. Metrics runs 13 database queries and the asset routes decode the
 * ledger, so both are cached, but a cache only helps a cache hit: the limiter
 * is what bounds a client arriving faster than the window. */
export function mountRateLimits(
  app: Application,
  { limit = 60, windowMs = 60_000 }: Partial<RateLimitOptions> = {},
  mounts: string[] = rateLimitedPaths(),
): void {
  // A limiter per mount, not one shared across the list. Sharing an instance
  // spends a single budget for every route it is mounted on, so a reader who
  // exhausted metrics was refused the asset pages too.
  for (const path of mounts) app.use(path, rateLimiter({ limit, windowMs }));
}

/** Tests only. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Drops windows that have expired. Without this the map grows with every
 * distinct client address the process ever sees. */
export function startRateLimitSweeper(intervalMs = 300_000): void {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, intervalMs).unref();
}
