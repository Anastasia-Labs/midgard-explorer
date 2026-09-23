import { expect, test } from "./helpers";

/**
 * Budgets for the pages, not just for the build.
 *
 * The nightly job enforces a memory ceiling on the BUILD. Nothing enforced
 * anything about what a visitor downloads or how long a route takes to become
 * readable, so a page could double in weight and every gate would stay green.
 *
 * The numbers below are ceilings with headroom, not targets. They exist to
 * catch a step change, which is the kind of regression review misses: nobody
 * notices a route getting 15% heavier, and everybody notices it having tripled.
 * Raise one deliberately when a feature earns it, and say so in the commit.
 *
 * Measured on the fixture, so they describe the interface rather than the size
 * of anyone's chain.
 */

/**
 * Transferred kilobytes for everything a route pulls, measured against the
 * production build the e2e project starts.
 *
 * Set from measurement, not from a guess. Every one of these four routes
 * currently transfers 93KB, so the ceiling is roughly 2.7x that: loose enough
 * that a legitimate feature does not trip it, tight enough that a doubling
 * does. The first version of this file used 12,000, which a route could have
 * exceeded only by growing more than a hundredfold, and would have passed
 * forever while measuring nothing.
 *
 * Raise one deliberately when a feature earns it, and say so in the commit.
 */
const WEIGHT_BUDGET_KB: Record<string, number> = {
  "/": 250,
  "/blocks": 250,
  "/transactions": 250,
  "/l1": 250,
};

/** Time to the route's own heading being visible. */
const READY_BUDGET_MS = 20_000;

for (const [path, budgetKb] of Object.entries(WEIGHT_BUDGET_KB)) {
  test(`${path} stays inside its weight and readiness budget`, async ({ page }) => {
    let bytes = 0;
    page.on("response", (res) => {
      const len = Number(res.headers()["content-length"] ?? 0);
      // Hot-reload and dev-only endpoints are not what a visitor downloads.
      if (!res.url().includes("_next/static/development") && Number.isFinite(len)) bytes += len;
    });

    const started = Date.now();
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1, h2").first()).toBeVisible();
    const readyMs = Date.now() - started;

    const kb = Math.round(bytes / 1024);
    expect(readyMs, `${path} took ${readyMs}ms to become readable`).toBeLessThan(READY_BUDGET_MS);
    expect(kb, `${path} transferred ${kb}KB, budget ${budgetKb}KB`).toBeLessThan(budgetKb);
  });
}

/**
 * A list page must not issue one request per row.
 *
 * The shape of an N+1 in the browser: a page that fetches its rows and then a
 * detail for each. It stays fast on a fixture with a handful of rows and falls
 * over on a real chain, which is exactly the case a local run cannot feel.
 */
test("a list page does not issue a request per row", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) apiCalls.push(req.url());
  });
  await page.goto("/blocks");
  // `:visible`, matching the rest of the suite. Each row renders twice, as a
  // desktop table cell and a narrow-viewport ledger entry, and only one of the
  // two is on screen at any width.
  await expect(page.locator('a[href^="/block/"]:visible').first()).toBeVisible();

  const rows = await page.locator('a[href^="/block/"]:visible').count();
  expect(rows).toBeGreaterThan(0);
  // A small constant, not a function of the row count. Server components fetch
  // on the server, so the browser should see very few API calls at all.
  expect(
    apiCalls.length,
    `${apiCalls.length} browser API calls for ${rows} rows: ${apiCalls.slice(0, 5).join(", ")}`,
  ).toBeLessThan(Math.max(8, rows));
});
