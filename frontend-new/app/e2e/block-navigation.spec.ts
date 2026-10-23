import { FIXTURE, expect, settle, test } from "./helpers";

/**
 * Phase 4.2: walking the chain from a block page.
 *
 * Taken from cexplorer's block page. The heights are shown rather than bare
 * arrows because Midgard heights are not consecutive: a height is the lowest
 * row id in its block, so the block before #20 can be #14.
 */

const openBlock = async (page: import("@playwright/test").Page, offset = 2) => {
  const rows = await page.request
    .get(`${FIXTURE}/api/blocks/1`)
    .then(async (r) => (await r.json()).rows as Array<{ header_hash: string; height: number }>);
  const row = rows[offset]!;
  await page.goto(`/block/${row.header_hash}`);
  await settle(page);
  return row;
};

test.describe("adjacent blocks", () => {
  test("offers the block before and the block after, by number", async ({ page }) => {
    await openBlock(page);
    const nav = page.getByRole("navigation", { name: "Adjacent blocks" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(2);
  });

  test("walking back lands on the block it named", async ({ page }) => {
    await openBlock(page);
    const nav = page.getByRole("navigation", { name: "Adjacent blocks" });
    const prev = nav.getByRole("link").first();
    const label = (await prev.getAttribute("aria-label")) ?? "";
    const height = /number (\d+)/.exec(label)?.[1];
    expect(height).toBeDefined();
    await prev.click();
    await settle(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`#${height}`);
  });

  test("says which end it is at rather than dropping the control", async ({ page }) => {
    // The newest block has no next. The control keeps its shape so the page
    // does not reflow between blocks.
    const rows = await page.request
      .get(`${FIXTURE}/api/blocks/1`)
      .then(async (r) => (await r.json()).rows as Array<{ header_hash: string }>);
    await page.goto(`/block/${rows[0]!.header_hash}`);
    await settle(page);
    const nav = page.getByRole("navigation", { name: "Adjacent blocks" });
    await expect(nav.getByText("Tip")).toBeVisible();
  });
});
