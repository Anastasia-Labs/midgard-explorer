import { config } from "../src/config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter, resetRateLimits } from "../src/server/rateLimit.js";
import { securityHeaders, resolveCorsOrigin } from "../src/server/security.js";

/** Trust is configuration, so a test about trust has to set it. Restored on the
 * way out so one case cannot decide another's outcome.
 *
 * The edge is named rather than counted. A hop count let a deployment trust
 * "two hops back" without saying who either hop was, and trust was then granted
 * to any peer in a private range. */
type ProxyConfig = {
  TRUSTED_PROXY_MODE: "none" | "single-edge";
  TRUSTED_PROXY_PEERS: string[];
};

function behindEdge(
  peers: string[],
  body: () => void,
  mode: "none" | "single-edge" = "single-edge",
): void {
  const mutable = config as unknown as ProxyConfig;
  const mode0 = mutable.TRUSTED_PROXY_MODE;
  const peers0 = mutable.TRUSTED_PROXY_PEERS;
  mutable.TRUSTED_PROXY_MODE = mode;
  mutable.TRUSTED_PROXY_PEERS = peers;
  try {
    body();
  } finally {
    mutable.TRUSTED_PROXY_MODE = mode0;
    mutable.TRUSTED_PROXY_PEERS = peers0;
  }
}

/** The compose topology: one nginx on the bridge network. */
const EDGE = ["10.0.0.0/8"];


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
    // Needs a named edge. Without one the peer is the identity and both of
    // these are the same client, which is the correct answer for an
    // unconfigured deployment and the wrong one for this scenario.
    behindEdge(EDGE, () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let passed = 0;
      limit(mkReq("10.0.0.1", "203.0.113.7"), mkRes().res, () => (passed += 1));
      limit(mkReq("10.0.0.1", "203.0.113.8"), mkRes().res, () => (passed += 1));
      expect(passed).toBe(2);
    });
  });

  /** With no edge configured, the socket peer is the identity and the header
   * is not read at all. This is the default, and it is what makes a deployment
   * safe before anyone has thought about its topology. */
  it("ignores a forwarded chain when no edge is trusted", () => {
    behindEdge(EDGE, () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let passed = 0;
      // Two different forged chains from one peer. Both are the same client.
      limit(mkReq("10.0.0.1", "203.0.113.7"), mkRes().res, () => (passed += 1));
      limit(mkReq("10.0.0.1", "203.0.113.8"), mkRes().res, () => (passed += 1));
      expect(passed).toBe(1);
    }, "none");
  });

  /** The regression this exists to close. The limiter read the LEFTMOST entry,
   * which is whatever the client wrote first, so any direct caller could rotate
   * it per request, never be limited, and grow the bucket map with forged
   * identities. The rightmost entry is the one the nearest trusted hop wrote. */
  it("reads the client the edge wrote, not the one the client sent", () => {
    behindEdge(EDGE, () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let passed = 0;
      // The edge appended 10.0.0.9; 203.0.113.7 is the client's own claim.
      limit(
        mkReq("10.0.0.1", "203.0.113.7, 10.0.0.9"),
        mkRes().res,
        () => (passed += 1),
      );
      // A different forged prefix, same real client. One bucket, so refused.
      limit(
        mkReq("10.0.0.1", "198.51.100.4, 10.0.0.9"),
        mkRes().res,
        () => (passed += 1),
      );
      expect(passed).toBe(1);
    });
  });

  /** The effect the limiter exists for: two genuinely different viewers get
   * two budgets. Asserted alongside the case above, because a limiter that
   * collapsed everyone into one bucket would also pass that one. */
  it("gives two viewers the edge distinguishes their own budgets", () => {
    behindEdge(EDGE, () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let passed = 0;
      limit(mkReq("10.0.0.1", "203.0.113.7"), mkRes().res, () => (passed += 1));
      limit(mkReq("10.0.0.1", "203.0.113.8"), mkRes().res, () => (passed += 1));
      expect(passed).toBe(2);
    });
  });

  /** The forwarded chain is only evidence when a proxy we run wrote it. From
   * the open internet it is client-settable, so honouring it hands out a fresh
   * budget per forged value and grows the bucket map for free. */
  it("ignores a forwarded address from a peer that is not our proxy", () => {
    behindEdge(EDGE, () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let passed = 0;
      limit(mkReq("203.0.113.7", "9.9.9.1"), mkRes().res, () => (passed += 1));
      limit(mkReq("203.0.113.7", "9.9.9.2"), mkRes().res, () => (passed += 1));
      expect(passed).toBe(1);
    });
  });

  /** The narrowing. A private peer is no longer a trusted peer: anything that
   * can reach the port from inside the network used to be able to present
   * itself as the edge and state any client identity it liked. */
  it("ignores a private peer that is not the named edge", () => {
    behindEdge(["172.18.0.1"], () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let passed = 0;
      limit(mkReq("10.0.0.1", "203.0.113.7"), mkRes().res, () => (passed += 1));
      limit(mkReq("10.0.0.1", "203.0.113.8"), mkRes().res, () => (passed += 1));
      expect(passed).toBe(1);
    });
  });

  it("matches the named edge inside its CIDR and nothing outside it", () => {
    behindEdge(["172.18.0.0/16"], () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let inside = 0;
      limit(mkReq("172.18.0.1", "203.0.113.7"), mkRes().res, () => (inside += 1));
      limit(mkReq("172.18.9.9", "203.0.113.8"), mkRes().res, () => (inside += 1));
      expect(inside).toBe(2);
    });
    behindEdge(["172.18.0.0/16"], () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let outside = 0;
      limit(mkReq("172.19.0.1", "203.0.113.7"), mkRes().res, () => (outside += 1));
      limit(mkReq("172.19.0.1", "203.0.113.8"), mkRes().res, () => (outside += 1));
      expect(outside).toBe(1);
    });
  });

  it("trusts a loopback edge only when it is the named one", () => {
    behindEdge(["127.0.0.1"], () => {
      const limit = rateLimiter({ limit: 1, windowMs: 60_000 });
      let passed = 0;
      limit(mkReq("::ffff:127.0.0.1", "203.0.113.7"), mkRes().res, () => (passed += 1));
      limit(mkReq("::ffff:127.0.0.1", "203.0.113.8"), mkRes().res, () => (passed += 1));
      expect(passed).toBe(2);
    });
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
