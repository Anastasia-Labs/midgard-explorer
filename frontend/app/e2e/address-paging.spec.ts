import { expect, expectNoViolations, settle, test } from "./helpers";
import { VIEWPORTS } from "./layout";
import { ADDRESSES, PAGED_ADDRESS } from "./fixtures/data.mjs";

/**
 * The address page shows one page of UTxOs while the balance and the count keep
 * describing the whole address. What this proves in a browser, which the
 * component tests cannot: the count and the list disagree on purpose, the way
 * forward exists and works, and the second page is different rows rather than
 * the same ones again.
 *
 * `PAGED_ADDRESS` is the fixture's many-UTxO address. The others hold six, so a
 * review against them would pass without paging anything.
 */
const PAGED = PAGED_ADDRESS;
const at = (address: string, query = "") => `/address/${encodeURIComponent(address)}${query}`;

const openUtxos = async (page: import("@playwright/test").Page, url: string) => {
  await page.goto(url);
  await settle(page);
  const tab = page.getByRole("tab", { name: /UTxOs/i });
  await tab.click();
  await settle(page);
};

test.describe("address UTxO paging", () => {
  test("shows a page of UTxOs while the count describes the whole address", async ({ page }) => {
    await openUtxos(page, at(PAGED));

    // 60 UTxOs, 50 to a page: the tab count must not be the row count.
    await expect(page.getByText(/Showing 50 of 60 UTxOs/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Next 50/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /First 50/i })).toHaveCount(0);
  });

  test("the next page is different rows, and offers the way back", async ({ page }) => {
    await openUtxos(page, at(PAGED));

    // Scope to the UTxO table: the Activity table is in the DOM too, and its
    // rows legitimately repeat because the history page did not change.
    const utxoRows = () =>
      page
        .locator("table", { has: page.locator("caption", { hasText: /Spendable UTxOs/i }) })
        .locator("tbody tr");

    const firstRowIds = await utxoRows().allInnerTexts();
    await page.getByRole("link", { name: /Next 50/i }).click();
    await settle(page);

    await expect(page.getByText(/Showing 10 of 60 UTxOs/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /First 50/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Next 50/i })).toHaveCount(0);

    const secondRowIds = await utxoRows().allInnerTexts();
    expect(secondRowIds.length).toBeGreaterThan(0);
    for (const row of secondRowIds) expect(firstRowIds).not.toContain(row);
  });

  test("an address that fits on one page shows no paging controls", async ({ page }) => {
    await openUtxos(page, at(ADDRESSES[1] ?? ""));

    await expect(page.getByRole("link", { name: /Next 50/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /First 50/i })).toHaveCount(0);
    await expect(page.getByText(/Showing \d+ of \d+ UTxOs/i)).toHaveCount(0);
  });

  for (const width of ["phone", "desktop"] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test(`paging controls stay usable on ${width} in ${scheme}`, async ({ page }) => {
        await page.setViewportSize(VIEWPORTS[width]);
        await page.emulateMedia({ colorScheme: scheme });
        await openUtxos(page, at(PAGED));

        const next = page.getByRole("link", { name: /Next 50/i });
        await expect(next).toBeVisible();

        // Visible is not the same as reachable: a control pushed outside the
        // viewport still reports visible to Playwright.
        const box = await next.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORTS[width].width);

        await expectNoViolations(page, `address-paging-${width}-${scheme}`);
      });
    }
  }
});
