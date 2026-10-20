import type { APIRequestContext } from "@playwright/test";
import { APPLIED_STATUSES, FIXTURE, expect, rowRegion, settle, test } from "./helpers";

type Row = { tx_id: string; status: string; finalization_status: string | null };

async function unsettledCommitted(request: APIRequestContext) {
  const rows = (await (await request.get(`${FIXTURE}/api/transactions/1`)).json()).rows as Row[];
  const row = rows.find(
    (r) => r.status === "committed" && !APPLIED_STATUSES.includes(r.finalization_status ?? ""),
  );
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
          name: /^(Waiting to merge|Merged|Merge not recorded|Finalized|Committed|Pending|Submitted|Awaiting|Abandoned)/,
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
    const mark = panel.getByRole("button", { name: "Waiting to merge", exact: true }).first();
    await expect(mark).toBeVisible();
    await mark.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Waiting to merge");
  });

  test("a filter with no matches says so, and can be cleared", async ({ page }) => {
    await page.goto("/withdrawals?id=00");
    await expect(page.getByText("No matching withdrawal")).toBeVisible();
    await expect(page.getByText(/appear once/i)).toHaveCount(0);
    await page.getByRole("link", { name: "Clear filter" }).click();
    await expect(page).toHaveURL(/\/withdrawals$/);
  });
});

for (const path of [
  "/blocks",
  "/transactions",
  "/deposits",
  "/withdrawals",
  "/forced-transactions",
  "/l1",
]) {
  test(`${path} shows list statuses without per-row help or a status key`, async ({ page }) => {
    await page.goto(path);
    // Rows with a status must be on screen, or a count of zero proves nothing.
    await expect(
      rowRegion(page)
        .getByText(
          /^(Committed|Waiting to merge|Merged|Merge not recorded|Finalized|Awaiting|Consumed|Projected|Valid|Accepted)$/,
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByText("Status key", { exact: true })).toHaveCount(0);
    await expect(rowRegion(page).getByRole("button", { name: /^About (?!.*decode)/ })).toHaveCount(
      0,
    );
  });
}

test("phone address activity exposes settlement without expanding details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const deposits = await page.request.get(`${FIXTURE}/api/deposits/1`).then((r) => r.json());
  await page.goto(`/address/${deposits.rows[0].ledger_address}`);
  const line = rowRegion(page).locator("li").first();
  await expect(line.getByText("L1", { exact: true })).toBeVisible();
  await expect(line.locator("details[open]")).toHaveCount(0);
});

test("a filtered deposit list says so while it has results", async ({ page }) => {
  const deposits = await page.request.get(`${FIXTURE}/api/deposits/1`).then((r) => r.json());
  const id = deposits.rows[0].event_id as string;
  await page.goto(`/deposits?id=${id}`);
  // The note sits above the table, outside rowRegion, so look for it on the page.
  await expect(page.getByText(/Filtered by record/)).toBeVisible();
  await expect(rowRegion(page)).toBeVisible();
  await page.getByRole("link", { name: "Clear filter" }).click();
  await expect(page).toHaveURL(/\/deposits$/);
  await expect(page.getByText(/Filtered by record/)).toHaveCount(0);
});

test("a malformed filter says it was ignored instead of passing as filtered", async ({ page }) => {
  await page.goto("/deposits?id=zzz");
  await expect(page.getByText(/Ignored filter/)).toBeVisible();
  await expect(page.getByText(/Filtered by record/)).toHaveCount(0);
  await expect(rowRegion(page)).toBeVisible();
});

test("a repeated filter uses its first value", async ({ page }) => {
  const deposits = await page.request.get(`${FIXTURE}/api/deposits/1`).then((r) => r.json());
  const id = deposits.rows[0].event_id as string;
  await page.goto(`/deposits?id=${id}&id=zzz`);
  await expect(page.getByText(/Filtered by record/)).toBeVisible();
  await expect(page.getByText(/Ignored filter/)).toHaveCount(0);
});
