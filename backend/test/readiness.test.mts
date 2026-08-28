import { describe, expect, it } from "vitest";
import express from "express";
import { checkReadiness, readinessRoute } from "../src/server/readiness.js";

/**
 * `/healthz` answers from the process alone, which is what a liveness probe
 * needs and all a restart decision may depend on. It cannot say whether the
 * explorer can serve a single row: it returned `ok` with both databases
 * unreachable. Readiness is the separate question, and a load balancer needs
 * the two answered separately or it restarts a healthy process because a
 * database went away.
 */

const ok = async () => {};
const fails = async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:5433");
};
const hangs = () => new Promise<void>(() => {});

describe("checkReadiness", () => {
  it("is ready when every database answers", async () => {
    const report = await checkReadiness({ node: ok, index: ok });
    expect(report.ready).toBe(true);
    expect(report.checks.map((c) => c.name).sort()).toEqual(["index", "node"]);
    expect(report.checks.every((c) => c.ok)).toBe(true);
  });

  it("names which database failed and still reports the others", async () => {
    const report = await checkReadiness({ node: fails, index: ok });
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.name === "node")?.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "index")?.ok).toBe(true);
  });

  it("bounds a probe that never returns, so the probe cannot hang", async () => {
    const report = await checkReadiness({ node: hangs }, { timeoutMs: 25 });
    expect(report.ready).toBe(false);
    expect(report.checks[0].ok).toBe(false);
  });

  /** A probe failure carries a connection string in its message often enough
   * that repeating it publicly is a credential leak. The detail belongs in the
   * log, and the response says only which check failed. */
  it("repeats nothing from the driver's error message", async () => {
    const report = await checkReadiness({ node: fails, index: ok });
    expect(JSON.stringify(report)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(report)).not.toContain("5433");
  });

  it("measures each probe", async () => {
    const report = await checkReadiness({ node: ok });
    expect(report.checks[0].latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("probe frequency", () => {
  /** A probe endpoint is unauthenticated and outside the /api rate limit, so a
   * flood of requests would otherwise open two database round trips each and
   * compete with real traffic for a pool of 8 and 5 connections. One second of
   * memory collapses a flood into one pair of queries and is far shorter than
   * any probe interval. */
  it("answers repeat calls within the window without re-querying", async () => {
    let calls = 0;
    const counted = async () => {
      calls += 1;
    };
    const probes = { node: counted };

    await checkReadiness(probes, { cacheMs: 50 });
    await checkReadiness(probes, { cacheMs: 50 });
    expect(calls).toBe(1);
  });

  it("re-queries once the window has passed", async () => {
    let calls = 0;
    const counted = async () => {
      calls += 1;
    };
    const probes = { node: counted };

    await checkReadiness(probes, { cacheMs: 5 });
    await new Promise((r) => setTimeout(r, 12));
    await checkReadiness(probes, { cacheMs: 5 });
    expect(calls).toBe(2);
  });

  it("does not remember anything when no window is asked for", async () => {
    let calls = 0;
    const counted = async () => {
      calls += 1;
    };
    const probes = { node: counted };

    await checkReadiness(probes);
    await checkReadiness(probes);
    expect(calls).toBe(2);
  });
});

describe("the readiness route", () => {
  const listen = (probes: Parameters<typeof readinessRoute>[0]) => {
    const app = express();
    app.get("/readyz", readinessRoute(probes));
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    return { url: `http://127.0.0.1:${port}/readyz`, server };
  };

  it("answers 200 when the explorer can serve data", async () => {
    const { url, server } = listen({ node: ok, index: ok });
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect((await res.json()).ready).toBe(true);
    server.close();
  });

  /** 503, not 200 with a false flag: a load balancer reads the status line. */
  it("answers 503 when a database it needs is unreachable", async () => {
    const { url, server } = listen({ node: fails, index: ok });
    const res = await fetch(url);
    expect(res.status).toBe(503);
    expect((await res.json()).ready).toBe(false);
    server.close();
  });

  it("is never cached, so a stale answer cannot keep a dead process in rotation", async () => {
    const { url, server } = listen({ node: ok });
    const res = await fetch(url);
    expect(res.headers.get("cache-control")).toContain("no-store");
    server.close();
  });
});
