import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { gunzipSync } from "node:zlib";

/**
 * Request measurement.
 *
 * Latency is reported as p50, p95 and p99 because a mean hides exactly the
 * tail the budgets exist to bound. Timeouts are counted separately from errors:
 * a request that returns a body after the deadline has failed, and folding it
 * into the error rate makes a slow route look correct.
 *
 * Wire bytes are read from the response stream rather than from a decoded body,
 * because the budget is about what crosses the network. The identity size is
 * fetched separately so the compression ratio is computable per route rather
 * than assumed.
 */

export type Sample = {
  ms: number;
  status: number;
  timedOut: boolean;
  wireBytes: number;
};

export type Stats = {
  /** Requests issued, including the ones that failed. Rates divide by this. */
  count: number;
  /**
   * Requests that returned a usable response.
   *
   * Latency percentiles are taken from these alone. A timeout contributes its
   * whole ceiling to the sample and an error returns almost instantly, so a
   * population mixing them describes neither the route's speed nor its
   * failures. `errorRate` and `timeoutRate` carry the failures instead.
   */
  successCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorRate: number;
  timeoutRate: number;
  rps: number;
  wireBytes: number;
  uncompressedBytes: number;
};

/** Nearest-rank percentile. No interpolation: a real observation, not a blend. */
export function percentileOf(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

/**
 * One timed request, counting the bytes that actually crossed the connection.
 *
 * Uses `node:http` rather than `fetch`. `fetch` transparently decompresses a
 * `Content-Encoding` response, so `arrayBuffer().byteLength` is the *decoded*
 * size: a 50 KB body compressed to 300 bytes measures as 50 KB, and a
 * compression budget built on it would report no compression at all. Reading
 * the raw chunks is the only way to get the number the budget is about.
 */
export async function timedRequest(
  url: string,
  timeoutMs: number,
  encoding: "gzip, br" | "identity" = "gzip, br",
  extra?: { bypass: string },
): Promise<Sample> {
  const target = new URL(url);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  const started = performance.now();

  return new Promise<Sample>((resolve) => {
    let settled = false;
    const finish = (sample: Sample) => {
      if (settled) return;
      settled = true;
      resolve(sample);
    };

    const req = send(
      target,
      {
        headers: {
          "Accept-Encoding": encoding,
          ...(extra ? { "x-explorer-bench-bypass": extra.bypass } : {}),
        },
      },
      (res) => {
        let wireBytes = 0;
        // Counted per chunk, before any decoding. Nothing here decompresses.
        res.on("data", (chunk: Buffer) => {
          wireBytes += chunk.length;
        });
        res.on("end", () => {
          finish({
            ms: performance.now() - started,
            status: res.statusCode ?? -1,
            timedOut: false,
            wireBytes,
          });
        });
        res.on("error", () => {
          finish({
            ms: performance.now() - started,
            status: -1,
            timedOut: false,
            wireBytes,
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish({
        ms: performance.now() - started,
        status: 0,
        timedOut: true,
        wireBytes: 0,
      });
    });
    req.on("error", () => {
      finish({
        ms: performance.now() - started,
        status: settled ? 0 : -1,
        timedOut: false,
        wireBytes: 0,
      });
    });
    req.end();
  });
}

/** Summarises samples. `elapsedMs` is wall time for the whole run, for RPS. */
export function summarise(
  samples: readonly Sample[],
  elapsedMs: number,
  uncompressedBytes: number,
): Stats {
  const errors = samples.filter((s) => s.timedOut === false && (s.status < 200 || s.status >= 400));
  const timeouts = samples.filter((s) => s.timedOut);
  // One definition of success, used for the latency population and the payload
  // alike, rather than two that disagree at the edges.
  const ok = samples.filter((s) => !s.timedOut && s.status >= 200 && s.status < 400);
  const latencies = ok.map((s) => s.ms);
  return {
    count: samples.length,
    successCount: ok.length,
    p50Ms: percentileOf(latencies, 0.5),
    p95Ms: percentileOf(latencies, 0.95),
    p99Ms: percentileOf(latencies, 0.99),
    maxMs: latencies.length > 0 ? Math.max(...latencies) : 0,
    errorRate: samples.length === 0 ? 0 : errors.length / samples.length,
    timeoutRate: samples.length === 0 ? 0 : timeouts.length / samples.length,
    rps: elapsedMs === 0 ? 0 : (samples.length / elapsedMs) * 1000,
    // The median successful response, not the mean: one oversize transaction
    // detail would otherwise dominate the figure for a whole route.
    wireBytes: percentileOf(ok.map((s) => s.wireBytes), 0.5),
    uncompressedBytes,
  };
}

/** Runs `total` requests at `concurrency`, returning every sample. */
export async function runRequests(
  urlFor: (i: number) => string,
  total: number,
  concurrency: number,
  timeoutMs: number,
  /** Set for a `cold` workload, so neither cache layer is read or written. */
  extra?: { bypass: string },
): Promise<{ samples: Sample[]; elapsedMs: number }> {
  const samples: Sample[] = [];
  const started = performance.now();
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= total) return;
      samples.push(await timedRequest(urlFor(index), timeoutMs, "gzip, br", extra));
    }
  });
  await Promise.all(workers);
  return { samples, elapsedMs: performance.now() - started };
}

/** The identity-encoded size, for the compression ratio. */
export async function identitySize(url: string, timeoutMs: number): Promise<number> {
  const sample = await timedRequest(url, timeoutMs, "identity");
  return sample.wireBytes;
}

/** Decompresses a gzip body, used to check an encoded response is not larger. */
export function inflatedSize(body: Uint8Array): number {
  try {
    return gunzipSync(body).byteLength;
  } catch {
    return body.byteLength;
  }
}
