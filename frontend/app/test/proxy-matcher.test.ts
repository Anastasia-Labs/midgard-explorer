import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "../src/proxy";

describe("CSP proxy coverage", () => {
  it.each(["/", "/api-docs", "/tools", "/apiary"])("protects document %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });
  it.each([{ purpose: "prefetch" }, { "next-router-prefetch": "1" }])(
    "does not let request headers disable document protection: %s",
    (headers) => {
      expect(unstable_doesMiddlewareMatch({ config, url: "/", headers })).toBe(true);
    },
  );
  it.each(["/api/vitals", "/_next/static/chunk.js", "/_next/image", "/favicon.ico"])(
    "excludes resource %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
});
