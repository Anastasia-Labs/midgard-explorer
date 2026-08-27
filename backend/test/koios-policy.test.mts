import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * How this process talks to a shared public service it does not control, and
 * what it refuses to read.
 *
 * Split out of `hardening.test.mts` so these travel with `indexer/koios.ts`
 * rather than with the server surface. A commit that changed the reader while
 * its tests sat in another commit would not have typechecked on its own.
 */

/** `fetchTxInfo` refuses an answer that omits a requested hash, because its
 * caller deletes a window and rewrites it from the result. These cases are
 * about transport policy rather than completeness, so the stub returns the
 * smallest valid row for whatever was asked for. */
function okBody(init?: RequestInit): Response {
  const hashes: string[] = init?.body
    ? (JSON.parse(String(init.body))._tx_hashes ?? [])
    : [];
  return new Response(
    JSON.stringify(
      hashes.map((tx_hash) => ({
        tx_hash, block_height: 1, block_hash: "b".repeat(64),
        absolute_slot: 1, epoch_no: 1, tx_timestamp: 1, outputs: [],
        fee: "1", tx_size: 1, total_output: "1", tx_block_index: 1,
        deposit: "0", withdrawals: [], certificates: [],
      })),
    ),
    { status: 200 },
  );
}

describe("Koios request policy", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("retries a 429 and succeeds on a later attempt", async () => {
    vi.useRealTimers();
    const { fetchTxInfo } = await import("../src/indexer/koios.js");
    let calls = 0;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      calls += 1;
      if (calls < 3) return new Response("busy", { status: 429 });
      return okBody(init);
    }) as typeof fetch;
    await fetchTxInfo(["a".repeat(64)]);
    expect(calls).toBe(3);
  }, 20_000);

  // A 400 means the request is wrong. Retrying it is three wrong answers.
  it("does not retry a 400", async () => {
    vi.useRealTimers();
    const { fetchTxInfo } = await import("../src/indexer/koios.js");
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    }) as typeof fetch;
    await expect(fetchTxInfo(["a".repeat(64)])).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  /**
   * The threshold, tested as arithmetic. Allocating a 32MB response to prove
   * this would exercise the very memory limit the guard exists to respect, on a
   * box with roughly a gigabyte free, and the test that did so failed with
   * "Invalid string length" rather than the assertion it was written for.
   *
   * The size is measured on the decoded body, not content-length: Koios gzips
   * and chunks, so that header is usually absent and a guard reading it would
   * report success while protecting nothing.
   */
  it("treats a body over 32MB as too large and anything under it as fine", async () => {
    const { isOverSizeLimit } = await import("../src/indexer/koios.js");
    const limit = 32 * 1024 * 1024;
    expect(isOverSizeLimit(limit + 1)).toBe(true);
    expect(isOverSizeLimit(limit)).toBe(false);
    expect(isOverSizeLimit(2)).toBe(false);
  });

  it("still parses a normal response, with no content-length header", async () => {
    vi.useRealTimers();
    const { fetchTxInfo } = await import("../src/indexer/koios.js");
    globalThis.fetch = (async (_u: string, init: RequestInit) =>
      okBody(init)) as typeof fetch;
    const parsed = await fetchTxInfo(["a".repeat(64)]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.tx_hash).toBe("a".repeat(64));
  });

  it("sends an abort signal so a hung request cannot stall the sync tick", async () => {
    vi.useRealTimers();
    const { fetchTxInfo } = await import("../src/indexer/koios.js");
    let sawSignal = false;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      sawSignal = init.signal instanceof AbortSignal;
      return okBody(init);
    }) as typeof fetch;
    await fetchTxInfo(["a".repeat(64)]);
    expect(sawSignal).toBe(true);
  });
});

/**
 * The limiter namespaces buckets per instance, which buys nothing unless the
 * routes actually get their own instance. Driven through a real express app,
 * because the defect this covers was in the wiring and not in the middleware:
 * one instance was mounted four times, so a client that spent its metrics
 * budget was refused on the asset routes too.
 */
describe("bounded response reading", () => {
  it("stops reading once the body passes the limit", async () => {
    const { readBounded } = await import("../src/indexer/koios.js");
    let pulled = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(10));
      },
    });
    await expect(readBounded(new Response(body), 20, "/tx_info")).rejects.toThrow(/limit/);
    // Three 10-byte chunks is the first read that can know it went over 20.
    expect(pulled).toBeLessThanOrEqual(3);
  });

  it("returns a body that stays under the limit", async () => {
    const { readBounded } = await import("../src/indexer/koios.js");
    expect(await readBounded(new Response("[1,2]"), 1_000, "/tx_info")).toBe("[1,2]");
  });
});

