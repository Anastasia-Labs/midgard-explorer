import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENDPOINTS, registerCatalogue } from "../src/server/catalogue.js";
import { postVitalsRoute } from "../src/server/routes/vitals.js";
import { registry } from "../src/telemetry/metrics.js";

/**
 * The one route that accepts data. Anyone can post to it, so what it must
 * guarantee is that a sample cannot add a series or an unbounded value, and
 * that what a browser actually sends is what it records.
 */

let base = "";
let close: () => void = () => {};

beforeAll(async () => {
  const app = express();
  app.post("/api/vitals", postVitalsRoute);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

/** As `navigator.sendBeacon` sends it: a text/plain blob. */
const beacon = (body: string) =>
  fetch(`${base}/api/vitals`, { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body });

const count = async (metric: string, labels: string) => {
  const match = new RegExp(`^${metric}_count\\{${labels}\\} (\\d+)$`, "m").exec(await registry.metrics());
  return match ? Number(match[1]) : 0;
};

describe("POST /api/vitals", () => {
  it("records a sample in seconds, under its route and device class", async () => {
    const labels = 'route_class="detail",device_class="mobile"';
    const before = await count("explorer_web_vitals_lcp_seconds", labels);
    const res = await beacon(JSON.stringify({ name: "LCP", value: 2400, routeClass: "detail", deviceClass: "mobile" }));
    expect(res.status).toBe(204);
    expect(await count("explorer_web_vitals_lcp_seconds", labels)).toBe(before + 1);
    // 2,400 ms sits inside the 2.5 s bucket, the budget's own boundary.
    expect(await registry.metrics()).toMatch(
      new RegExp(`explorer_web_vitals_lcp_seconds_bucket\\{le="2.5",${labels}\\} [1-9]`),
    );
  });

  it("keeps CLS unitless", async () => {
    const res = await beacon(JSON.stringify({ name: "CLS", value: 0.05, routeClass: "list", deviceClass: "desktop" }));
    expect(res.status).toBe(204);
    expect(await registry.metrics()).toMatch(
      /explorer_web_vitals_cls_bucket\{le="0.05",route_class="list",device_class="desktop"\} [1-9]/,
    );
  });

  it("refuses anything outside the closed sets, so no sample adds a series", async () => {
    const valid = { name: "INP", value: 120, routeClass: "overview", deviceClass: "desktop" };
    for (const body of [
      { ...valid, name: "FID" },
      { ...valid, routeClass: "/block/00ff" },
      { ...valid, deviceClass: "tablet" },
      { ...valid, value: -1 },
      { ...valid, value: 60_001 },
      { ...valid, extra: "label" },
    ]) {
      expect((await beacon(JSON.stringify(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await beacon("not json")).status).toBe(400);
    expect(await registry.metrics()).not.toMatch(/00ff|tablet|FID/);
  });

  it("refuses a body over 1 KB before parsing it", async () => {
    expect((await beacon(JSON.stringify({ padding: "x".repeat(2_000) }))).status).toBe(413);
  });
});

describe("the catalogue entry", () => {
  it("is a limited, uncached POST, and registers as one", async () => {
    const entry = ENDPOINTS.find((e) => e.path === "/api/vitals");
    expect(entry).toMatchObject({ method: "post", rateLimited: true, cacheSeconds: 0 });
    const app = express();
    registerCatalogue(app);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/vitals`;
    try {
      expect((await fetch(url)).status).toBe(404);
      expect(
        (await fetch(url, { method: "POST", body: JSON.stringify({ name: "CLS", value: 0, routeClass: "other", deviceClass: "desktop" }) })).status,
      ).toBe(204);
    } finally {
      server.close();
    }
  });
});
