import { expect, settle, test } from "./helpers";

/**
 * Phase 4.5: the production chart.
 *
 * The data was already there (`series` carries blocks and transactions per
 * hour) and only blocks were drawn, with the per-hour figures reachable by
 * hovering an SVG `<title>`. Hover is not a channel: it does not exist on
 * touch and screen readers treat it inconsistently, which is the same defect
 * the `title=` attributes had.
 */

const section = (page: import("@playwright/test").Page, name: string) =>
  page.locator("section", { has: page.getByRole("heading", { name }) });

/** Each measure is drawn in the list it describes, so neither needs a toggle
 * and both are visible at once. */
test.describe("blocks and transactions per hour", () => {
  test("draws blocks above the latest blocks and transactions above the latest transactions", async ({
    page,
  }) => {
    await page.goto("/");
    await settle(page);
    await expect(
      section(page, "Latest blocks").getByRole("img", { name: /^blocks per hour/i }),
    ).toBeVisible();
    await expect(
      section(page, "Latest transactions").getByRole("img", { name: /^transactions per hour/i }),
    ).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: /chart measure/i })).toHaveCount(0);
  });

  test("puts every hour's figures in a table, not behind a hover", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    // Visually hidden, but in the accessibility tree: this is how the numbers
    // reach a reader who cannot hover.
    for (const name of ["Blocks per hour", "Transactions per hour"]) {
      const table = page.getByRole("table", { name });
      await expect(table).toBeAttached();
      expect(await table.getByRole("row").count()).toBeGreaterThan(1);
    }
  });

  /** The list pages are where each measure is read in depth, so each carries
   * its own chart above its table. */
  test("draws each measure on its own list page", async ({ page }) => {
    await page.goto("/blocks");
    await expect(page.getByRole("img", { name: /^blocks per hour/i })).toBeVisible();
    await page.goto("/transactions");
    await expect(page.getByRole("img", { name: /^transactions per hour/i })).toBeVisible();
  });

  test("keeps no hover-only tooltip in the chart", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    expect(await page.locator("svg title").count()).toBe(0);
  });
});
