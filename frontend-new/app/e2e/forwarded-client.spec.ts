import { FIXTURE, expect, settle, test } from "./helpers";

/**
 * What the frontend forwards to the backend, and what it refuses to.
 *
 * Browser traffic never reaches the backend directly: a route handler or a
 * server component fetches on the viewer's behalf. Without forwarding an
 * address, every reader in the world shares one rate-limit bucket and the first
 * symptom is a 429 for someone else's traffic. The route handlers forwarded it;
 * the server-rendered pages did not, which left the asset routes on one shared
 * budget.
 *
 * This spec used to assert only that a header the test itself set arrived at
 * the backend, which is the exploitable behaviour rather than the intended one:
 * it passed just as well when the value was a forgery the frontend had copied
 * through. What has to hold is narrower. Exactly one entry is forwarded, and it
 * is the one the nearest trusted hop wrote, not the prefix a client chose. The
 * backend then ignores even that unless TRUSTED_PROXY_HOPS says it sits behind
 * a real edge.
 */
test.describe("what the frontend forwards", () => {
  test("passes the address on from a server-rendered page, not only a route handler", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.9" });
    await page.goto("/assets");
    await settle(page);

    const seen = await (await page.request.get(`${FIXTURE}/__forwarded`)).json();
    expect(seen["/api/assets"]).toBe("203.0.113.9");
  });

  test("keeps only the nearest entry, discarding the prefix a client chose", async ({ page }) => {
    // Everything left of the last entry was written further from the edge,
    // which means a client could have written it. Forwarding the chain intact
    // is what let a caller state any identity it liked.
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": "198.51.100.1, 203.0.113.9",
    });
    await page.goto("/assets");
    await settle(page);

    const seen = await (await page.request.get(`${FIXTURE}/__forwarded`)).json();
    expect(seen["/api/assets"]).toBe("203.0.113.9");
    expect(seen["/api/assets"]).not.toContain("198.51.100.1");
  });

  // "forwards nothing when there is no chain" is deliberately not asserted
  // here. The fixture records the last value it saw per path and Next may serve
  // the page from cache, so a run that makes no fresh request reads the value
  // an earlier case left behind. That is a property of the observation, not of
  // the code, and a test that passes or fails on cache state is worse than no
  // test. It is covered where it is deterministic, in the unit tests for
  // forwardedFrom.
});
