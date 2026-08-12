import { FIXTURE, expect, settle, test } from "./helpers";

/**
 * The backend limits the expensive routes per client address. Browser traffic
 * never reaches it directly: a route handler or a server component fetches on
 * the viewer's behalf, so without forwarding the original address every reader
 * in the world shares one bucket, and the first symptom is a 429 for someone
 * else's traffic.
 *
 * The route handlers forwarded it. The server-rendered pages did not, which
 * left the asset routes, the ones that decode the ledger, on a single shared
 * budget. Only the fixture can tell us what actually arrived.
 */
test.describe("the viewer's address reaches the backend", () => {
  test("from a server-rendered page, not only from a route handler", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.9" });
    await page.goto("/assets");
    await settle(page);

    const seen = await (await page.request.get(`${FIXTURE}/__forwarded`)).json();
    expect(seen["/api/assets"]).toContain("203.0.113.9");
  });
});
