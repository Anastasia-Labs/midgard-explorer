import type { APIRequestContext } from "@playwright/test";
import { FIXTURE, expect, rowRegion, settle, test } from "./helpers";

type Row = { tx_id: string; status: string; finalization_status: string | null };

async function unsettledCommitted(request: APIRequestContext) {
  const rows = (await (await request.get(`${FIXTURE}/api/transactions/1`)).json()).rows as Row[];
  const row = rows.find((r) => r.status === "committed" && r.finalization_status !== "finalized");
  if (!row) throw new Error("fixture has no committed transaction in an unsettled block");
  return row;
}

test.describe("status clarity", () => {
  test("a committed transaction in an unsettled block never reads as settled", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const row = await unsettledCommitted(page.request);
    await page.goto("/transactions");
    await settle(page);
    const line = page.locator("tr", { has: page.locator(`a[href="/transaction/${row.tx_id}"]`) });
    await expect(line.getByText("Committed")).toBeVisible();
    await expect(line.getByText("Finalized")).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "L1 settlement" })).toBeVisible();
  });

  test("the subtitle no longer names a section the page lacks", async ({ page }) => {
    await page.goto("/transactions");
    await expect(page.getByText(/ledger equation/i)).toHaveCount(0);
  });

  test("phone rows show both statuses without expanding", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const row = await unsettledCommitted(page.request);
    await page.goto("/transactions");
    await settle(page);
    const card = rowRegion(page).locator("li", {
      has: page.locator(`a[href="/transaction/${row.tx_id}"]`),
    });
    await expect(card.getByText("Committed")).toBeVisible();
    await expect(card.getByText("L1", { exact: true })).toBeVisible();
  });

  test("the overview's latest transactions show how far each one got", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await settle(page);
    const panel = page.locator("section", {
      has: page.getByRole("heading", { name: "Latest transactions" }),
    });
    // One mark per row, named by its state.
    await expect(
      panel
        .getByRole("button", {
          name: /^(Finalized|Committed|Pending|Submitted|Awaiting|Abandoned)/,
        })
        .first(),
    ).toBeVisible();
  });

  test("the overview's status marks name their state on hover", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await settle(page);
    const panel = page.locator("section", {
      has: page.getByRole("heading", { name: "Latest blocks" }),
    });
    const mark = panel.getByRole("button", { name: "Finalized", exact: true }).first();
    await expect(mark).toBeVisible();
    await mark.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Finalized");
  });

  test("a filter with no matches says so, and can be cleared", async ({ page }) => {
    await page.goto("/withdrawals?id=00");
    await expect(page.getByText("No matching withdrawal")).toBeVisible();
    await expect(page.getByText(/appear once/i)).toHaveCount(0);
    await page.getByRole("link", { name: "Clear filter" }).click();
    await expect(page).toHaveURL(/\/withdrawals$/);
  });
});
