import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachePublicJson, cached, clearCache } from "../src/server/cache.js";

/**
 * Two public routes do real work per request: metrics runs 13 database queries,
 * and the asset scan decodes up to 20,000 UTxOs. Without a cache, anyone can
 * make the server do that as fast as they can send requests.
 */

beforeEach(() => {
  clearCache();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("cached", () => {
  it("runs the work once inside the window", async () => {
    let runs = 0;
    const work = cached("k", 10_000, async () => ++runs);
    expect(await work()).toBe(1);
    expect(await work()).toBe(1);
    expect(runs).toBe(1);
  });

  it("runs it again once the window has passed", async () => {
    let runs = 0;
    const work = cached("k", 10_000, async () => ++runs);
    await work();
    vi.advanceTimersByTime(10_001);
    expect(await work()).toBe(2);
  });

  it("keeps separate keys separate", async () => {
    const a = cached("a", 10_000, async () => "A");
    const b = cached("b", 10_000, async () => "B");
    expect(await a()).toBe("A");
    expect(await b()).toBe("B");
  });

  // A cached failure would keep a transient database error alive for the whole
  // window, long after the cause cleared.
  it("does not cache a rejection", async () => {
    let runs = 0;
    const work = cached("k", 10_000, async () => {
      runs += 1;
      if (runs === 1) throw new Error("database blinked");
      return "recovered";
    });
    await expect(work()).rejects.toThrow("database blinked");
    expect(await work()).toBe("recovered");
  });

  // The cache exists to stop a burst becoming N scans. Serving the first
  // request and letting nine more start their own would defeat it.
  it("collapses concurrent callers onto one run", async () => {
    let runs = 0;
    const work = cached("k", 10_000, async () => {
      runs += 1;
      await Promise.resolve();
      return runs;
    });
    const all = await Promise.all([work(), work(), work()]);
    expect(runs).toBe(1);
    expect(all).toEqual([1, 1, 1]);
  });
});

describe("public JSON response cache", () => {
  it("serves repeated GETs without rerunning the handler", async () => {
    vi.useRealTimers();
    const app = express();
    let runs = 0;
    app.get("/api/value", cachePublicJson(10_000, 10, 10_000_000), (_req, res) => {
      runs += 1;
      res.json({ runs });
    });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/value`);
      const second = await fetch(`http://127.0.0.1:${port}/api/value`);
      expect(await first.json()).toEqual({ runs: 1 });
      expect(await second.json()).toEqual({ runs: 1 });
      expect(runs).toBe(1);
      expect(first.headers.get("x-explorer-cache")).toBe("MISS");
      expect(second.headers.get("x-explorer-cache")).toBe("HIT");
      expect(second.headers.get("cache-control")).toContain("s-maxage=10");
    } finally {
      server.close();
    }
  });

  /** The bound that was missing. A thousand entries sounds small until one of
   * them is a transaction response carrying 64KB of inline CBOR: the count
   * alone permits about a hundred megabytes on a box that already swaps. */
  it("evicts by size, not only by count", async () => {
    const app = express();
    const big = "x".repeat(50_000);
    app.get(
      "/api/big/:n",
      cachePublicJson(10_000, 100, 120_000),
      (req, res) => void res.json({ n: req.params.n, blob: big }),
    );
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const get = (n: number) => fetch(`http://127.0.0.1:${port}/api/big/${n}`);

    // Three bodies of roughly 50KB against a 120KB budget: the first is evicted
    // to make room for the third, though the entry count never reaches 100.
    await get(1);
    await get(2);
    await get(3);
    expect((await get(3)).headers.get("x-explorer-cache")).toBe("HIT");
    expect((await get(1)).headers.get("x-explorer-cache")).toBe("MISS");
    server.close();
  });

  it("still evicts by count when the bodies are small", async () => {
    const app = express();
    app.get(
      "/api/small/:n",
      cachePublicJson(10_000, 2, 10_000_000),
      (req, res) => void res.json({ n: req.params.n }),
    );
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const get = (n: number) => fetch(`http://127.0.0.1:${port}/api/small/${n}`);

    await get(1);
    await get(2);
    await get(3);
    expect((await get(1)).headers.get("x-explorer-cache")).toBe("MISS");
    expect((await get(3)).headers.get("x-explorer-cache")).toBe("HIT");
    server.close();
  });

  it("does not advertise an error as cacheable", async () => {
    vi.useRealTimers();
    const app = express();
    app.get("/api/fail", cachePublicJson(10_000, 10, 10_000_000), (_req, res) => {
      res.status(503).json({ error: "later" });
    });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/fail`);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-accel-expires")).toBeNull();
    } finally {
      server.close();
    }
  });
});
