import type { Page } from "@playwright/test";
import { FIXTURE, expect, expectNoViolationsInBothThemes, settle, test } from "./helpers";

/**
 * The block page's Merkle roots tab: the twelve roots of the node's
 * finalization record, each beside the previous header's. A root is a
 * commitment, so no string on the tab may call it a proof or a verification.
 */

const hashAt = async (page: Page, height: number): Promise<string> => {
  const body = await page.request
    .get(`${FIXTURE}/api/blocks/by-height/${height}`)
    .then(async (r) => (await r.json()) as { header_hash: string });
  return body.header_hash;
};

test.describe("block Merkle roots", () => {
  test("shows each root beside the previous header's and says how they compare", async ({
    page,
  }) => {
    // Neither block 10 nor block 9 carries a forced transaction, so both commit
    // to the empty tree: the one pair the fixture makes equal.
    await page.goto(`/block/${await hashAt(page, 10)}?tab=roots`);
    await settle(page);
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("UTxOs root")).toBeVisible();
    // Seven roots, and every row carries exactly one of the three outcomes:
    // four differ, the forced transactions root matches because neither block
    // carries one, and the node records no base for the last two.
    await expect(panel.getByRole("listitem")).toHaveCount(7);
    await expect(panel.getByText("Differs from the previous header")).toHaveCount(4);
    await expect(panel.getByText("Same as the previous header")).toHaveCount(1);
    await expect(panel.getByText("No previous root to compare")).toHaveCount(2);
    await expect(panel.getByText("Not reported by the node")).toHaveCount(2);
    await expect(panel).not.toContainText(/proof|verif/i);
  });

  test("says the node reports no roots when it holds no finalization record", async ({ page }) => {
    await page.goto(`/block/${await hashAt(page, 11)}?tab=roots`);
    await settle(page);
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("Not reported by the node.")).toBeVisible();
    await expect(panel.getByText("UTxOs root")).toHaveCount(0);
  });

  test("the data availability tab sends the reader here for roots", async ({ page }) => {
    await page.goto(`/block/${await hashAt(page, 10)}?tab=da`);
    await settle(page);
    await page.getByRole("tabpanel").getByRole("link", { name: "Merkle roots" }).click();
    await expect(page).toHaveURL(/tab=roots/);
    await expect(page.getByRole("tabpanel").getByText("UTxOs root")).toBeVisible();
  });

  test("the Cardano evidence roots stay one disclosure down", async ({ page }) => {
    // They are a second source for the same commitments, kept and demoted
    // rather than removed: the page leads with the node's own record.
    await page.goto(`/block/${await hashAt(page, 10)}?tab=l1`);
    await settle(page);
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("Previous UTxOs root")).toBeHidden();
    await panel.getByText("Roots recorded on Cardano").click();
    await expect(panel.getByText("Previous UTxOs root")).toBeVisible();
  });

  test("meets the accessibility rules in both themes", async ({ page }) => {
    await expectNoViolationsInBothThemes(page, `/block/${await hashAt(page, 10)}?tab=roots`);
  });
});
