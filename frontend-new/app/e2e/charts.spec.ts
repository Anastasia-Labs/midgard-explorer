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

test.describe("blocks and transactions per hour", () => {
  test("offers both measures, with blocks selected", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const group = page.getByRole("radiogroup", { name: /chart measure/i });
    await expect(group.getByRole("radio")).toHaveText([/Blocks/, /Transactions/]);
    await expect(group.getByRole("radio", { name: "Blocks" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("switches to transactions, and says so", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await page.getByRole("radio", { name: "Transactions" }).click();
    await expect(page).toHaveURL(/[?&]chart=transactions/);
    await expect(page.getByRole("img", { name: /transactions per hour/i })).toBeVisible();
  });

  test("puts every hour's figures in a table, not behind a hover", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    // Visually hidden, but in the accessibility tree: this is how the numbers
    // reach a reader who cannot hover.
    const table = page.getByRole("table", { name: /blocks and transactions per hour/i });
    await expect(table).toBeAttached();
    expect(await table.getByRole("row").count()).toBeGreaterThan(1);
  });

  test("keeps no hover-only tooltip in the chart", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    expect(await page.locator("svg title").count()).toBe(0);
  });
});
