import { describe, expect, it, beforeEach } from "vitest";
import express from "express";
import {
  benchBypassEnabled,
  cachePublicJson,
  cached,
  clearCache,
  configureBenchBypass,
} from "../src/server/cache.js";

/**
 * The benchmark cache bypass.
 *
 * Two properties matter and both are security-shaped. Without a configured
 * token the bypass must not exist, or a public deployment gains a header that
 * disables the caches protecting it from amplification. And a request that
 * bypasses must neither read the cache nor write to it, or the run warms the
 * cache for whatever measures next.
 */

const TOKEN = "bench-token-0123456789";
const HEADER = "x-explorer-bench-bypass";

/** A live server, matching how the other cache tests exercise the middleware. */
const serve = () => {
  const app = express();
  let calls = 0;
  const work = cached(`probe-${Math.random()}`, 10_000, async () => {
    calls += 1;
    return { calls };
  });
  app.get("/api/thing", cachePublicJson(5_000, 100, 1_000_000), async (_req, res) => {
    res.json(await work());
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  return {
    get: (token?: string) =>
      fetch(`http://127.0.0.1:${port}/api/thing`, {
        headers: token === undefined ? {} : { [HEADER]: token },
      }),
    calls: () => calls,
    close: () => server.close(),
  };
};

beforeEach(() => {
  clearCache();
  configureBenchBypass(null);
});

describe("benchmark cache bypass", () => {
  it("does not exist unless a token is configured", async () => {
    expect(benchBypassEnabled()).toBe(false);
    const s = serve();
    try {
      // The header is present but no token is configured: it must be ignored.
      await s.get(TOKEN);
      const second = await s.get(TOKEN);
      expect(second.headers.get("x-explorer-cache")).toBe("HIT");
      expect(s.calls()).toBe(1);
    } finally {
      s.close();
    }
  });

  it("rejects a short token, so a guessable one cannot enable it", () => {
    configureBenchBypass("short");
    expect(benchBypassEnabled()).toBe(false);
    configureBenchBypass("");
    expect(benchBypassEnabled()).toBe(false);
  });

  it("ignores a wrong token even when the bypass is configured", async () => {
    configureBenchBypass(TOKEN);
    const s = serve();
    try {
      await s.get("not-the-token-abcdef");
      const second = await s.get("not-the-token-abcdef");
      expect(second.headers.get("x-explorer-cache")).toBe("HIT");
      expect(s.calls()).toBe(1);
    } finally {
      s.close();
    }
  });

  it("misses both cache layers on every bypassed request", async () => {
    configureBenchBypass(TOKEN);
    const s = serve();
    try {
      for (let i = 0; i < 3; i += 1) {
        const res = await s.get(TOKEN);
        expect(res.headers.get("x-explorer-cache")).toBe("BYPASS");
      }
      // The inner work cache is bypassed too. Bypassing only the response
      // cache would still measure a cached reading on /api/metrics.
      expect(s.calls()).toBe(3);
    } finally {
      s.close();
    }
  });

  it("does not warm the cache for the requests that follow", async () => {
    configureBenchBypass(TOKEN);
    const s = serve();
    try {
      await s.get(TOKEN);
      const after = await s.get();
      // A normal request afterwards must still be a MISS: the bypassed run
      // wrote nothing.
      expect(after.headers.get("x-explorer-cache")).toBe("MISS");
      expect(s.calls()).toBe(2);
    } finally {
      s.close();
    }
  });

  it("leaves an ordinary request cached while a bypass is configured", async () => {
    configureBenchBypass(TOKEN);
    const s = serve();
    try {
      await s.get();
      const second = await s.get();
      expect(second.headers.get("x-explorer-cache")).toBe("HIT");
      expect(s.calls()).toBe(1);
    } finally {
      s.close();
    }
  });
});
