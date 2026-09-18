import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { routeClass, vitalSample, type RouteClass } from "../src/lib/vitals";

/**
 * The Web Vitals budget is judged per route class, so every page must land in
 * the class a reader would expect. The list of pages comes from the app
 * directory rather than from this file, so a new page fails here until someone
 * decides its class.
 */

const APP = new URL("../src/app/", import.meta.url).pathname;

const EXPECTED: Record<string, RouteClass> = {
  "/": "overview",
  "/blocks": "list",
  "/blocks/[page]": "list",
  "/transactions": "list",
  "/transactions/[page]": "list",
  "/deposits": "list",
  "/deposits/[page]": "list",
  "/withdrawals": "list",
  "/withdrawals/[page]": "list",
  "/forced-transactions": "list",
  "/forced-transactions/[page]": "list",
  "/assets": "list",
  "/l1": "list",
  "/block/[headerHash]": "detail",
  "/block/height/[height]": "detail",
  "/transaction/[txHash]": "detail",
  "/address/[address]": "detail",
  "/asset/[unit]": "detail",
  "/asset/by-fingerprint/[fingerprint]": "detail",
  "/l1/transaction/[txHash]": "detail",
  "/l1/validator/[scriptHash]": "detail",
  "/glossary": "other",
  "/tools": "other",
  "/api-docs": "other",
};

/** Every page route in the app directory, route groups removed. */
function pages(dir = APP): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...pages(path));
    else if (entry === "page.tsx") {
      const route = `/${relative(APP, dir)}`.replace(/\/\([^)]+\)/g, "").replace(/\/$/, "");
      found.push(route === "" ? "/" : route);
    }
  }
  return found.sort();
}

/** A concrete path for a template: `[page]` becomes a number, anything else a hash. */
const concrete = (template: string) =>
  template.replace(/\[page\]|\[height\]/g, "42").replace(/\[[^\]]+\]/g, "ab".repeat(28));

describe("routeClass", () => {
  it("classifies every page in the app, and knows no page the app lacks", () => {
    expect(pages()).toEqual(Object.keys(EXPECTED).sort());
    for (const template of pages()) {
      expect(routeClass(concrete(template)), template).toBe(EXPECTED[template]);
    }
  });

  it("ignores a trailing slash, and calls an unknown path other", () => {
    expect(routeClass("/blocks/")).toBe("list");
    expect(routeClass("/no-such-page")).toBe("other");
    expect(routeClass("/blocks/not-a-number")).toBe("other");
  });
});

describe("vitalSample", () => {
  it("builds the sample the backend accepts", () => {
    expect(vitalSample({ name: "LCP", value: 2400 }, "/block/" + "ab".repeat(28), true)).toEqual({
      name: "LCP",
      value: 2400,
      routeClass: "detail",
      deviceClass: "mobile",
    });
  });

  it("sends nothing for a metric the budget does not name, or a value no browser reports", () => {
    expect(vitalSample({ name: "FCP", value: 900 }, "/", false)).toBeNull();
    expect(vitalSample({ name: "TTFB", value: 80 }, "/", false)).toBeNull();
    expect(vitalSample({ name: "CLS", value: Number.NaN }, "/", false)).toBeNull();
    expect(vitalSample({ name: "INP", value: -1 }, "/", false)).toBeNull();
  });
});
