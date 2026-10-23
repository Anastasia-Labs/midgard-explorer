import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../src/server/catalogue.js";

/**
 * The bundled reverse proxy publishes a fixed set of paths, and the catalogue
 * decides what the API serves. Nothing connected the two, so a route could be
 * added, tested, and served, and still answer 404 to every deployment that
 * runs the cache. That is what happened to `/readyz`: the page's own status
 * indicator reads it through the proxy, and the footer reported an unreachable
 * API on every page while the backend and both databases were answering.
 */
const TEMPLATE = new URL("../../infra/nginx/explorer-api.conf.template", import.meta.url);

/** The rendered form, near enough. `${BACKEND_ORIGIN}` carries a closing brace
 * of its own, which a reader looking for the end of a block would take for the
 * end of the block. */
const CONFIG = readFileSync(TEMPLATE, "utf8").replace(/\$\{[^}]*\}/g, "backend:3101");

/** Each `location` block that actually forwards, as a predicate over a request
 * path. `location /` returns 404 rather than proxying, so a body without
 * `proxy_pass` is not a published path. */
function proxiedMatchers(config: string): Array<(path: string) => boolean> {
  const matchers: Array<(path: string) => boolean> = [];
  for (const block of config.split("location ").slice(1)) {
    const header = block.slice(0, block.indexOf("{")).trim();
    const body = block.slice(block.indexOf("{") + 1, block.indexOf("}"));
    if (!body.includes("proxy_pass")) continue;
    if (header.startsWith("= ")) {
      const exact = header.slice(2).trim();
      matchers.push((path) => path === exact);
    } else if (header.startsWith("~ ")) {
      const pattern = new RegExp(header.slice(2).trim());
      matchers.push((path) => pattern.test(path));
    } else {
      matchers.push((path) => path.startsWith(header));
    }
  }
  return matchers;
}

describe("reverse proxy surface", () => {
  const matchers = proxiedMatchers(CONFIG);

  it("forwards on more than one rule", () => {
    // Guards the parser itself: a config it failed to read would otherwise
    // make every assertion below vacuous.
    expect(matchers.length).toBeGreaterThan(1);
  });

  it("publishes every path the catalogue serves", () => {
    const unpublished = ENDPOINTS.map((endpoint) => endpoint.path).filter(
      (path) => !matchers.some((matches) => matches(path)),
    );
    expect(unpublished).toEqual([]);
  });

  it("keeps the probes uncached, since a cached answer is a stale one", () => {
    const probes = CONFIG.split("location ")
      .slice(1)
      .find((block) => block.slice(0, block.indexOf("{")).includes("readyz"));
    expect(probes).toBeDefined();
    expect(probes!.slice(0, probes!.indexOf("}"))).toContain("proxy_cache off");
  });
});
