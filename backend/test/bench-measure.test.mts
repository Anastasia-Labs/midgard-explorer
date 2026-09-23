import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import {
  encodedSize,
  identitySize,
  percentileOf,
  runRequests,
  summarise,
  timedRequest,
} from "../bench/measure.mjs";

/**
 * Measured against a local server whose behaviour is known exactly, so a wrong
 * reading is a defect in the measurement rather than an ambiguity about the
 * thing measured.
 */

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/slow") {
      setTimeout(() => res.end("slow"), 300);
      return;
    }
    if (url.pathname === "/error") {
      res.statusCode = 500;
      res.end("no");
      return;
    }
    if (url.pathname === "/big") {
      const body = Buffer.from("x".repeat(50_000));
      if ((req.headers["accept-encoding"] ?? "").includes("gzip")) {
        res.setHeader("Content-Encoding", "gzip");
        res.end(gzipSync(body));
        return;
      }
      res.end(body);
      return;
    }
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("percentileOf", () => {
  it("returns a real observation, never an interpolation", () => {
    const values = [1, 2, 3, 4, 100];
    expect(percentileOf(values, 0.5)).toBe(3);
    expect(percentileOf(values, 0.99)).toBe(100);
    expect(values).toContain(percentileOf(values, 0.95));
  });

  it("is empty-safe", () => {
    expect(percentileOf([], 0.95)).toBe(0);
  });
});

describe("timedRequest", () => {
  it("measures a successful response and its wire bytes", async () => {
    const sample = await timedRequest(`${base}/`, 5_000);
    expect(sample.status).toBe(200);
    expect(sample.timedOut).toBe(false);
    expect(sample.wireBytes).toBe(2);
    expect(sample.ms).toBeGreaterThan(0);
  });

  it("marks a timeout as a timeout, not an error", async () => {
    // A body arriving after the deadline has still failed, and folding it into
    // the error rate would make a slow route look correct.
    const sample = await timedRequest(`${base}/slow`, 50);
    expect(sample.timedOut).toBe(true);
    expect(sample.status).toBe(0);
  });

  it("reports bytes on the wire, not the decoded size", async () => {
    const encoded = await timedRequest(`${base}/big`, 5_000, "gzip, br");
    const identity = await identitySize(`${base}/big`, 5_000);
    expect(identity).toBe(50_000);
    // Compressible content, so the wire form must be far smaller than identity.
    expect(encoded.wireBytes).toBeLessThan(identity / 10);
  });
});

describe("summarise", () => {
  it("separates errors from timeouts and computes throughput", () => {
    const samples = [
      { ms: 10, status: 200, timedOut: false, wireBytes: 100 },
      { ms: 20, status: 500, timedOut: false, wireBytes: 10 },
      { ms: 30, status: 0, timedOut: true, wireBytes: 0 },
      { ms: 40, status: 200, timedOut: false, wireBytes: 300 },
    ];
    const stats = summarise(samples, 1_000, 900);
    expect(stats.errorRate).toBe(0.25);
    expect(stats.timeoutRate).toBe(0.25);
    expect(stats.rps).toBe(4);
    // The median successful response, so one oversize body cannot dominate.
    // Nearest rank over the two successes [100, 300] is the lower, 100. That
    // is the point: a mean would report 200 and an oversize outlier would drag
    // the figure for a whole route.
    expect(stats.wireBytes).toBe(100);
    expect(stats.uncompressedBytes).toBe(900);
  });
});

describe("runRequests", () => {
  it("issues every request and honours concurrency", async () => {
    const { samples, elapsedMs } = await runRequests(() => `${base}/`, 12, 4, 5_000);
    expect(samples.length).toBe(12);
    expect(elapsedMs).toBeGreaterThan(0);
    expect(samples.every((s) => s.status === 200)).toBe(true);
  });

  it("records failures rather than throwing", async () => {
    const { samples } = await runRequests(() => `${base}/error`, 4, 2, 5_000);
    const stats = summarise(samples, 100, 0);
    expect(stats.errorRate).toBe(1);
  });
});

describe("the latency population is successes only", () => {
  const sample = (ms: number, status: number, timedOut = false) => ({
    ms, status, timedOut, wireBytes: 100,
  });

  it("excludes errors and timeouts, so a fast 500 cannot flatter a percentile", () => {
    // Nine real 100 ms responses plus a 1 ms error. Including the error would
    // drag the median down and report a route as faster than it ever was.
    const withError = summarise(
      [...Array.from({ length: 9 }, () => sample(100, 200)), sample(1, 500)],
      1_000,
      0,
    );
    expect(withError.count).toBe(10);
    expect(withError.successCount).toBe(9);
    expect(withError.p50Ms).toBe(100);
    // The rate still carries the failure; only the latency population drops it.
    expect(withError.errorRate).toBeCloseTo(0.1, 5);
  });

  it("excludes a timeout, whose ceiling is not a measurement of the route", () => {
    const withTimeout = summarise(
      [...Array.from({ length: 9 }, () => sample(100, 200)), sample(30_000, 0, true)],
      1_000,
      0,
    );
    expect(withTimeout.successCount).toBe(9);
    expect(withTimeout.maxMs).toBe(100);
    expect(withTimeout.timeoutRate).toBeCloseTo(0.1, 5);
  });

  it("reports no latency at all when nothing succeeded", () => {
    const none = summarise([sample(1, 503), sample(2, 503)], 100, 0);
    expect(none.successCount).toBe(0);
    expect(none.p95Ms).toBe(0);
    expect(none.errorRate).toBe(1);
  });
});

describe("encoded size is comparable to identity size", () => {
  it("asks for compression, unlike the measured requests", async () => {
    // The measured requests send no Accept-Encoding, so `wireBytes` is an
    // uncompressed body: on every fixed-path workload it equalled the identity
    // size exactly. Two register rows ask what compression saves, and two
    // numbers that are equal by construction cannot answer them.
    const identity = await identitySize(`${base}/big`, 5_000);
    const encoded = await encodedSize(`${base}/big`, 5_000);
    expect(identity).toBeGreaterThan(1024);
    expect(encoded).toBeLessThan(identity);
  });
});
