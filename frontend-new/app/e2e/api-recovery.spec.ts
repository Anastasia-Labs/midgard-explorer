import { expect, FIXTURE, inject, rowRegion, test } from "./helpers";

/**
 * A page opened while the API is down fills itself in once the API returns.
 *
 * The frontend starts without the backend, so every page has to survive a
 * missing API and then recover from it. Recovering by a reload is not enough:
 * a reader who opened the page first and started the backend second should see
 * the records arrive, not an error that stays until they think to refresh.
 *
 * `fail=all` makes the fixture answer 500 everywhere, including `/readyz`, so
 * the app's own `/api/health` reports the API down exactly as it does when
 * nothing is listening on the port. Clearing the fault is the backend coming
 * up.
 *
 * Each case marks the document before the API returns and checks the mark
 * afterwards. A full navigation would clear it, so the records arriving in a
 * fresh document would not pass for a recovery.
 */

/** While the API is down the health check polls every five seconds. Four
 * intervals covers the poll, the refresh and the render on a two-core
 * machine running a production build beside the browser. */
const RECOVERY_MS = 20_000;

const markDocument = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
  });

const sameDocument = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true);

test.describe("recovery when the API comes back", () => {
  // The default 30 seconds would leave no room for RECOVERY_MS after two page
  // loads of a production build.
  test.setTimeout(60_000);

  test("a list page fills itself in without a reload", async ({ page }) => {
    await inject(page, "fail=all");
    await page.goto("/blocks");
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toBeVisible();
    await markDocument(page);

    await inject(page, "fail=");

    await expect(alert).toBeHidden({ timeout: RECOVERY_MS });
    await expect(rowRegion(page)).toBeVisible();
    expect(await sameDocument(page), "the page reloaded instead of recovering").toBe(true);
  });

  /* A record page catches the failure itself, as every page that reads the API
   * does, so an outage shows the same inline alert here and never reaches the
   * route's error boundary. The boundary is for defects, and retrying a defect
   * on a timer would loop; it is deliberately not part of this.
   *
   * A transaction, not a block. The block detail is fetched with
   * `revalidate: 30`, so Next's data cache, which outlives a rebuild, serves a
   * block it has seen before straight through an outage and the page never
   * fails. That is reasonable for a record that cannot change, and it means a
   * block page tests the cache rather than the recovery. The transaction
   * detail is fetched uncached. */
  test("a record page fills itself in without a reload", async ({ page }) => {
    const rows = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows as Array<{ tx_id: string }>);
    const txId = rows[0]!.tx_id;
    await inject(page, "fail=all");
    await page.goto(`/transaction/${txId}`);
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toBeVisible();
    await markDocument(page);

    await inject(page, "fail=");

    await expect(alert).toBeHidden({ timeout: RECOVERY_MS });
    await expect(page.getByRole("tab").first()).toBeVisible();
    expect(await sameDocument(page), "the page reloaded instead of recovering").toBe(true);
  });
});
