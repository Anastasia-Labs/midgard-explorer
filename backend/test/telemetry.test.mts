import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { prisma } from "../src/db.js";
import { getBlocksPage, getLastBlocks } from "../src/db/block.js";
import { cachePublicJson, clearCache } from "../src/server/cache.js";
import { observeRequests } from "../src/telemetry/http.js";
import {
  UNMATCHED,
  indexerPassDuration,
  methodLabel,
  registry,
  routeLabel,
  statusClass,
  timedPass,
} from "../src/telemetry/metrics.js";
import { requestTally, type RequestTally } from "../src/telemetry/requestTally.js";
import { startMetricsServer } from "../src/telemetry/server.js";

/**
 * The production metrics.
 *
 * Checked through the registry's own exposition, the text a scraper reads,
 * rather than through the objects that produce it.
 */

const exposition = () => registry.metrics();

describe("labels", () => {
  it("names a route by its template, and an unrouted request as unmatched", () => {
    expect(routeLabel({ baseUrl: "", route: { path: "/api/blocks/:page" } })).toBe("/api/blocks/:page");
    expect(routeLabel({})).toBe(UNMATCHED);
  });

  it("keeps method and status to a closed set", () => {
    expect(methodLabel("GET")).toBe("GET");
    expect(methodLabel("PROPFIND")).toBe("other");
    expect(statusClass(204)).toBe("2xx");
    expect(statusClass(503)).toBe("5xx");
    expect(statusClass(999)).toBe("other");
  });
});

describe("request metrics", () => {
  it("records one series per route template, whatever the path, and counts cache results", async () => {
    clearCache();
    const app = express();
    app.use(observeRequests);
    app.get("/api/telemetry-probe/:page", cachePublicJson(5_000, 100, 1_000_000), (req, res) => {
      res.json({ page: req.params.page });
    });
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      for (const page of ["7", "8", "7"]) {
        const res = await fetch(`http://127.0.0.1:${port}/api/telemetry-probe/${page}`);
        await res.arrayBuffer();
      }
      await (await fetch(`http://127.0.0.1:${port}/nowhere/at/all`)).arrayBuffer();
    } finally {
      server.close();
    }
    const text = await exposition();
    const route = 'route="/api/telemetry-probe/:page"';
    expect(text).toContain(
      `explorer_http_request_duration_seconds_count{${route},method="GET",status_class="2xx"} 3`,
    );
    // A crawler walking every page would otherwise create a series per page.
    expect(text).not.toMatch(/telemetry-probe\/[78]/);
    expect(text).toContain(`explorer_response_cache_total{${route},result="miss"} 2`);
    expect(text).toContain(`explorer_response_cache_total{${route},result="hit"} 1`);
    expect(text).toMatch(/explorer_http_request_duration_seconds_count\{route="unmatched",method="GET",status_class="4xx"\} [1-9]/);
  });
});

describe("statement counting against a real database", () => {
  let reachable = false;
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1;`;
      reachable = true;
    } catch (error) {
      if (process.env.REQUIRE_DB === "1") throw error;
    }
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("counts route statements inside a transaction and leaves out BEGIN and COMMIT", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const tally: RequestTally = { routeStatements: 0 };
    // The page and its total, read in one snapshot: two route statements
    // wrapped in transaction control the budgets do not count.
    await requestTally.run(tally, () => getBlocksPage(1));
    expect(tally.routeStatements).toBe(2);

    const single: RequestTally = { routeStatements: 0 };
    await requestTally.run(single, () => getLastBlocks(3));
    expect(single.routeStatements).toBe(1);

    expect(await exposition()).toMatch(
      /explorer_db_statement_duration_seconds_count\{database="node",class="route-query"\} [1-9]/,
    );
  });

  it("reads normally when no request is being tallied", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    await expect(getLastBlocks(1)).resolves.toBeInstanceOf(Array);
  });
});

describe("indexer passes", () => {
  it("records success and failure, and rethrows the failure", async () => {
    const before = async (outcome: string) =>
      (await indexerPassDuration.get()).values.find(
        (v) => v.labels.outcome === outcome && v.metricName === "explorer_indexer_pass_duration_seconds_count",
      )?.value ?? 0;
    const successes = await before("success");
    const failures = await before("failure");
    await expect(timedPass(async () => 1)).resolves.toBe(1);
    await expect(timedPass(async () => { throw new Error("koios 503"); })).rejects.toThrow("koios 503");
    expect(await before("success")).toBe(successes + 1);
    expect(await before("failure")).toBe(failures + 1);
  });
});

describe("the metrics listener", () => {
  it("serves only GET /metrics, in the Prometheus text format, on the address it was given", async () => {
    const server = startMetricsServer("127.0.0.1", 0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    expect(address.address).toBe("127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const metrics = await fetch(`${base}/metrics`);
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("content-type")).toMatch(/^text\/plain; version=0\.0\.4/);
      const body = await metrics.text();
      expect(body).toContain("# TYPE explorer_http_request_duration_seconds histogram");
      expect(body).toContain("process_resident_memory_bytes");
      expect((await fetch(`${base}/`)).status).toBe(404);
      expect((await fetch(`${base}/metrics`, { method: "POST" })).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("refuses a metrics port that is the API port", () => {
    const base = parseConfig({ ...process.env, BACKEND_PORT: "3101" });
    expect(base.METRICS_HOST).toBe("127.0.0.1");
    expect(() => parseConfig({ ...process.env, BACKEND_PORT: "3101", METRICS_PORT: "3101" })).toThrow(
      /METRICS_PORT/,
    );
  });
});
