import { expect, test, isNarrow, rowRegion } from "./helpers";

/** The list existed as a backend route, a decoder and an API client for weeks
 * with no page reading them. These assert the page is wired to that data and
 * that it keeps the two honesty rules the header table has: an unattributed
 * commitment says so, and the list never claims to be complete. */

test("lists state commitments and links each one to its block", async ({ page }) => {
  await page.goto("/l1/commitments");
  await expect(page.getByRole("heading", { name: "State commitments" })).toBeVisible();

  const first = page.locator('a[href^="/block/"]:visible').first();
  await expect(first).toBeVisible();
  await first.click();

  await expect(page).toHaveURL(/\/block\/[0-9a-f]+$/);
  await expect(page.getByRole("heading", { name: "Block" }).first()).toBeVisible();
});

test("says when a commitment has no settlement transaction yet", async ({ page }) => {
  await page.goto("/l1/commitments");
  // The oldest fixture header is carried-forward only. An empty cell would read
  // as missing data rather than as an observation the indexer has not made.
  //
  // Asserted against whichever presentation the viewport actually renders: the
  // table on desktop, the ledger list below sm, where the field sits behind the
  // row's own disclosure and is not on screen until it is opened.
  const rows = rowRegion(page);
  if (await isNarrow(page)) {
    // Opened in one DOM pass rather than one click per row. The list is as long
    // as the fixture's header count, so a click loop spends the whole test
    // budget scrolling rows into view and times out on a slow machine while
    // testing nothing about scrolling. The disclosure's own click behaviour is
    // covered where it belongs, in the row component's tests.
    await rows.locator("details").first().waitFor();
    await rows.evaluate((region) => {
      for (const details of region.querySelectorAll("details")) details.open = true;
    });
  }
  await expect(rows.getByText("Not yet attributed").first()).toBeVisible();
});

test("is reachable from Cardano activity", async ({ page }) => {
  await page.goto("/l1");
  await page.getByRole("link", { name: "State commitments" }).click();
  await expect(page).toHaveURL(/\/l1\/commitments$/);
});
