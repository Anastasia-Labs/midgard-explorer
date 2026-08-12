import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearCache } from "../src/server/cache.js";

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
