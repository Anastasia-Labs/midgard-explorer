import { config } from "../config";
import { Application, NextFunction, Request, Response } from "express";
import { rateLimitedPaths } from "./catalogue";

/**
 * A fixed-window request limiter, per client, per limiter instance.
 *
 * In-process because one backend process sits behind the bundled reverse
 * proxy. A multi-instance deployment must also enforce a global budget at its
 * CDN/gateway; each process would otherwise provide its own allowance.
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

/**
 * Whether a peer is the edge this process was told to sit behind.
 *
 * Trust used to be granted to any address in a private range, so anything that
 * could reach the port from inside the network could present itself as the
 * edge and state a client identity. The edge is named now, as an exact address
 * or an IPv4 CIDR block, and nothing else is believed.
 */
function inCidr(address: string, block: string): boolean {
  const [network, bitsRaw] = block.split("/");
  const bits = Number(bitsRaw);
  if (!network || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (value: string): number | null => {
    const parts = value.split(".");
    if (parts.length !== 4) return null;
    let out = 0;
    for (const part of parts) {
      const octet = Number(part);
      if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
      out = (out << 8) | octet;
    }
    return out >>> 0;
  };
  const a = toInt(address);
  const b = toInt(network);
  if (a === null || b === null) return false;
  // A /0 shift by 32 is undefined in JS, so the whole-internet case is explicit.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

export function isTrustedProxy(peer: string | undefined): boolean {
  if (peer === undefined) return false;
  // Express reports an IPv4 peer over a dual-stack socket in this form.
  const address = peer.startsWith("::ffff:") ? peer.slice(7) : peer;
  return config.TRUSTED_PROXY_PEERS.some((entry) =>
    entry.includes("/") ? inCidr(address, entry) : entry === address,
  );
}

/**
 * The address this request is rate limited against.
 *
 * A private socket peer used to be enough to trust `x-forwarded-for`, and in
 * the bundled topology every request arrives from the compose bridge gateway.
 * Any direct client could therefore send its own header, rotate it per request
 * and never be limited, while also growing the bucket map with forged
 * identities.
 *
 * The edge is the only authority on client identity. It overwrites the chain
 * rather than appending to it, so exactly one entry is believed, the rightmost,
 * and only when this process has been told it sits behind a named edge. With
 * `TRUSTED_PROXY_MODE` at `none` the socket peer is the identity and a
 * forwarded header is ignored no matter who sent it.
 *
 * `req.ip` is undefined when the socket is already gone; those share one
 * bucket, which is correct because they are indistinguishable.
 */
function clientAddress(req: Request): string {
  const peer = req.ip;
  if (config.TRUSTED_PROXY_MODE === "single-edge" && isTrustedProxy(peer)) {
    const forwarded = req.headers?.["x-forwarded-for"];
    const chain = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const entries = (chain ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    // The rightmost entry is the one the edge wrote, and it is the only part a
    // client cannot forge. Taking the leftmost takes whatever the client put
    // there first.
    const identity = entries.at(-1);
    if (identity !== undefined) return identity;
  }
  return peer ?? "unknown";
}

let sequence = 0;

export function rateLimiter({ limit, windowMs }: RateLimitOptions) {
  // Each limiter gets its own namespace, so a client's metrics budget and its
  // asset budget are independent.
  const namespace = `rl${(sequence += 1)}`;

  return function limitRequests(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const key = `${namespace}:${clientAddress(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      setBudgetHeaders(res, limit, limit - 1, now + windowMs);
      return next();
    }

    if (bucket.count >= limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      setBudgetHeaders(res, limit, 0, bucket.resetAt);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many requests.",
        retryAfterSeconds: retryAfter,
      });
    }

    bucket.count += 1;
    setBudgetHeaders(res, limit, limit - bucket.count, bucket.resetAt);
    return next();
  };
}

function setBudgetHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number,
): void {
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader(
    "RateLimit-Reset",
    String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1_000))),
  );
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
