import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter, resetRateLimits } from "../src/server/rateLimit.js";
import { securityHeaders, resolveCorsOrigin } from "../src/server/security.js";

/** Express handles reduced to what these middlewares actually touch. */
const mkReq = (ip = "1.2.3.4", forwardedFor?: string) =>
  ({
    ip,
    path: "/api/metrics",
    method: "GET",
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  }) as never;

function mkRes() {
  const headers: Record<string, string> = {};
  let status = 200;
  let body: unknown = null;
  return {
    headers,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    res: {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      header: (k: string, v: string) => {
        headers[k] = v;
      },
      status: (c: number) => {
        status = c;
        return { json: (b: unknown) => (body = b) };
      },
      json: (b: unknown) => (body = b),
    } as never,
  };
}

describe("rateLimiter", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("allows requests up to the limit", () => {
    const limit = rateLimiter({ limit: 3, windowMs: 60_000 });
    const seen: boolean[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { res } = mkRes();
      limit(mkReq(), res, () => seen.push(true));
    }
    expect(seen).toHaveLength(3);
  });

  it("publishes the remaining shared budget", () => {
    const limit = rateLimiter({ limit: 3, windowMs: 60_000 });
    const first = mkRes();
    limit(mkReq(), first.res, () => {});
    expect(first.headers["RateLimit-Limit"]).toBe("3");
    expect(first.headers["RateLimit-Remaining"]).toBe("2");
    expect(first.headers["RateLimit-Reset"]).toBe("60");
  });

  it("refuses the one over the limit with 429", () => {
    const limit = rateLimiter({ limit: 2, windowMs: 60_000 });
    let passed = 0;
    const last = mkRes();
    for (let i = 0; i < 2; i += 1)
      limit(mkReq(), mkRes().res, () => (passed += 1));
    limit(mkReq(), last.res, () => (passed += 1));
    expect(passed).toBe(2);
    expect(last.status).toBe(429);
  });

  // Per client, or one busy reader silences everybody else.
  it("counts each client separately", () => {
    const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
    let passed = 0;
    limit(mkReq("1.1.1.1"), mkRes().res, () => (passed += 1));
    limit(mkReq("2.2.2.2"), mkRes().res, () => (passed += 1));
    expect(passed).toBe(2);
  });

  /**
   * Browser traffic reaches this API through the frontend's route handlers, so
   * every such request carries the frontend's socket address. Keying on that
   * alone would bucket every viewer in the world together, and the symptom
   * would be readers getting 429 for someone else's traffic.
   */
  it("separates clients that share one proxy address", () => {
    const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
    let passed = 0;
    limit(mkReq("10.0.0.1", "203.0.113.7"), mkRes().res, () => (passed += 1));
    limit(mkReq("10.0.0.1", "203.0.113.8"), mkRes().res, () => (passed += 1));
    expect(passed).toBe(2);
  });

  it("reads the client from the front of a forwarded chain", () => {
    const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
    let passed = 0;
    limit(
      mkReq("10.0.0.1", "203.0.113.7, 10.0.0.9"),
      mkRes().res,
      () => (passed += 1),
    );
    limit(
      mkReq("10.0.0.1", "203.0.113.7, 10.0.0.9"),
      mkRes().res,
      () => (passed += 1),
    );
    expect(passed).toBe(1);
  });

  /** The forwarded chain is only evidence when a proxy we run wrote it. From
   * the open internet it is client-settable, so honouring it hands out a fresh
   * budget per forged value and grows the bucket map for free. */
  it("ignores a forwarded address from a peer that is not our proxy", () => {
    const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
    let passed = 0;
    limit(mkReq("203.0.113.7", "9.9.9.1"), mkRes().res, () => (passed += 1));
    limit(mkReq("203.0.113.7", "9.9.9.2"), mkRes().res, () => (passed += 1));
    expect(passed).toBe(1);
  });

  it("still trusts the chain from a loopback proxy", () => {
    const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
    let passed = 0;
    limit(
      mkReq("::ffff:127.0.0.1", "203.0.113.7"),
      mkRes().res,
      () => (passed += 1),
    );
    limit(
      mkReq("::ffff:127.0.0.1", "203.0.113.8"),
      mkRes().res,
      () => (passed += 1),
    );
    expect(passed).toBe(2);
  });

  it("lets a client back in once the window rolls over", () => {
    const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
    let passed = 0;
    limit(mkReq(), mkRes().res, () => (passed += 1));
    limit(mkReq(), mkRes().res, () => (passed += 1));
    expect(passed).toBe(1);
    vi.advanceTimersByTime(60_001);
    limit(mkReq(), mkRes().res, () => (passed += 1));
    expect(passed).toBe(2);
  });
});

describe("securityHeaders", () => {
  it("sets the headers a JSON API needs", () => {
    const { headers, res } = mkRes();
    securityHeaders(mkReq(), res, () => {});
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    // An API serves no HTML, so nothing may be loaded on its behalf at all.
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
  });
});

describe("resolveCorsOrigin", () => {
  it("keeps the configured origin", () => {
    expect(resolveCorsOrigin("https://explorer.example", "production")).toBe(
      "https://explorer.example",
    );
  });

  it("allows the wildcard outside production, where it is convenient", () => {
    expect(resolveCorsOrigin("*", "development")).toBe("*");
  });

  // A wildcard reaching production is a configuration accident, not a choice.
  // Failing at boot is the only place it can be caught before users see it.
  it("refuses to boot production with a wildcard origin", () => {
    expect(() => resolveCorsOrigin("*", "production")).toThrow(/CORS_ORIGIN/);
  });
});

describe("rate limit mounts", () => {
  it("shares one aggregate budget across every public API route", async () => {
    const express = (await import("express")).default;
    const { mountRateLimits, resetRateLimits: reset } =
      await import("../src/server/rateLimit.js");
    reset();

    const app = express();
    mountRateLimits(app, { limit: 1, windowMs: 60_000 });
    app.get("/api/metrics", (_req, res) => void res.json({ ok: true }));
    app.get("/api/assets", (_req, res) => void res.json({ ok: true }));
    app.get("/api/transaction", (_req, res) => void res.json({ ok: true }));

    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as { port: number };
    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/metrics`);
      const second = await fetch(`http://127.0.0.1:${port}/api/metrics`);
      const other = await fetch(`http://127.0.0.1:${port}/api/assets`);
      const transaction = await fetch(
        `http://127.0.0.1:${port}/api/transaction`,
      );
      expect([first.status, second.status]).toEqual([200, 429]);
      expect(other.status).toBe(429);
      expect(transaction.status).toBe(429);
    } finally {
      server.close();
    }
  });
});
