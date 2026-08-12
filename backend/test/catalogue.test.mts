import express from "express";
import { describe, expect, it } from "vitest";
import {
  ENDPOINTS,
  documentationPath,
  openApiDocument,
  rateLimitedPaths,
  registerCatalogue,
} from "../src/server/catalogue.js";

/**
 * The API surface used to be declared four times: `routes.ts` registered it,
 * `openapi.ts` described it, this suite's predecessor asserted it against a
 * literal copy of itself, and the frontend listed it again for its docs page.
 * Adding a route meant four edits, and the only drift the tests could catch was
 * between the document and its own copy.
 *
 * So the catalogue owns registration, and everything else is derived. These
 * tests check the properties that make a derivation trustworthy. They never
 * compare generated paths against another hand-written list, because that is
 * the circularity this work exists to remove.
 */

describe("endpoint catalogue", () => {
  it("declares every route exactly once", () => {
    const keys = ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every endpoint the metadata the documentation needs", () => {
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.summary.length, endpoint.path).toBeGreaterThan(0);
      expect(endpoint.group.length, endpoint.path).toBeGreaterThan(0);
      expect(typeof endpoint.handler, endpoint.path).toBe("function");
    }
  });

  /** A path parameter that the express route captures but the document never
   * names is invisible to a consumer, and one the document names but express
   * never captures is a lie. Both are caught by comparing the route to itself. */
  it("documents every parameter its express path captures", () => {
    for (const endpoint of ENDPOINTS) {
      const captured = [...endpoint.path.matchAll(/:(\w+)/g)].map((m) => m[1]).sort();
      const documented = endpoint.parameters
        .filter((p) => p.in === "path")
        .map((p) => p.name)
        .sort();
      expect(documented, endpoint.path).toEqual(captured);
    }
  });

  it("converts express parameters into OpenAPI template syntax", () => {
    expect(documentationPath("/api/blocks/:page")).toBe("/api/blocks/{page}");
    expect(documentationPath("/api/blocks/by-height/:height")).toBe(
      "/api/blocks/by-height/{height}",
    );
    expect(documentationPath("/api/metrics")).toBe("/api/metrics");
  });
});

describe("generated OpenAPI document", () => {
  it("is OpenAPI 3.1 and carries one path item per catalogue entry", () => {
    const document = openApiDocument();
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual(
      ENDPOINTS.map((e) => documentationPath(e.path)).sort(),
    );
  });

  it("describes the rate limit where, and only where, one is enforced", () => {
    const document = openApiDocument();
    for (const endpoint of ENDPOINTS) {
      const operation = document.paths[documentationPath(endpoint.path)]?.get;
      const has429 = operation?.responses?.["429"] !== undefined;
      expect(has429, endpoint.path).toBe(endpoint.rateLimited);
    }
  });

  it("serializes, so a consumer can actually fetch it", () => {
    expect(() => JSON.stringify(openApiDocument())).not.toThrow();
  });

  /** The limiter mounts on path prefixes, so the derived list is not the list
   * of limited routes. The property that matters is coverage: every limited
   * route sits under exactly one mount, and no unlimited route sits under any. */
  it("covers every limited route with exactly one mount, and no unlimited one", () => {
    const mounts = rateLimitedPaths();
    const covers = (mount: string, path: string) =>
      path === mount || path.startsWith(`${mount}/`);

    for (const route of ENDPOINTS) {
      const matched = mounts.filter((mount) => covers(mount, route.path));
      expect(matched.length, `${route.path} matched ${JSON.stringify(matched)}`).toBe(
        route.rateLimited ? 1 : 0,
      );
    }
  });
});

describe("catalogue registration", () => {
  const app = express();
  registerCatalogue(app);
  const server = app.listen(0);
  const port = () => (server.address() as { port: number }).port;

  it("answers on a route that needs nothing but the process", async () => {
    const res = await fetch(`http://127.0.0.1:${port()}/healthz`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("serves the document it generated", async () => {
    const res = await fetch(`http://127.0.0.1:${port()}/api/openapi.json`);
    expect(res.status).toBe(200);
    expect((await res.json()).openapi).toBe("3.1.0");
  });

  /** Mounting, not behaviour. A database-backed route may fail without a
   * database; what must never happen is the router not knowing the path. */
  it("mounts the database-backed routes on the paths it declares", async () => {
    for (const path of ["/api/blocks/1", "/api/metrics", "/api/l1/summary"]) {
      const res = await fetch(`http://127.0.0.1:${port()}${path}`);
      expect(res.status, path).not.toBe(404);
    }
    server.close();
  });
});
