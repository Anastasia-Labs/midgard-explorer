import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "./helpers";

/* Each table shows its row list below the widest breakpoint any of its columns
 * hides at, so a field hidden from the table is still in the row. Checked one
 * pixel below and exactly at each table's boundary. */
// The list table sits in its own scroll wrapper; charts carry sr-only tables elsewhere.
const table = (page: Page) => page.locator("div.overflow-x-auto > table");
const rows = (page: Page) => page.locator("ul.divide-y > li");

const CASES: Array<{
  path: string;
  at: number;
  column: string;
  inRow: (row: ReturnType<Page["locator"]>) => Promise<void>;
}> = [
  {
    path: "/transactions",
    at: 1024,
    column: "In / out",
    inRow: async (row) => {
      await row.locator("summary").click();
      await expect(row.locator("dt", { hasText: "In / out" })).toBeVisible();
    },
  },
  {
    path: "/blocks",
    at: 1024,
    column: "Withdrawals",
    inRow: async (row) => {
      await expect(row.getByText(/\d+ withdrawals?\b/)).toBeVisible();
    },
  },
  {
    path: "/withdrawals",
    at: 1024,
    column: "Projected block",
    inRow: async (row) => {
      await row.locator("summary").click();
      await expect(row.locator("dt", { hasText: "Projected block" })).toBeVisible();
    },
  },
  {
    path: "/l1",
    at: 768,
    column: "State",
    inRow: async (row) => {
      await expect(
        row
          .getByText(
            /Waiting to merge|Merged|Merge not recorded|Finalized|Awaiting|Consumed|Projected/,
          )
          .first(),
      ).toBeVisible();
    },
  },
];

for (const c of CASES) {
  test(`${c.path} shows the row list below ${c.at}px with ${c.column} in the row`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: c.at - 1, height: 1000 });
    await page.goto(c.path);
    await expect(table(page)).toBeHidden();
    const first = rows(page).first();
    await expect(first).toBeVisible();
    await c.inRow(first);
  });

  test(`${c.path} shows the table from ${c.at}px with ${c.column}`, async ({ page }) => {
    await page.setViewportSize({ width: c.at, height: 1000 });
    await page.goto(c.path);
    await expect(table(page)).toBeVisible();
    await expect(rows(page).first()).toBeHidden();
    await expect(table(page).getByRole("columnheader", { name: c.column })).toBeVisible();
  });
}

test("address activity keeps Spent reachable on both sides of 1024px", async ({ page }) => {
  const deposits = await page.request.get(`${FIXTURE}/api/deposits/1`).then((r) => r.json());
  const path = `/address/${deposits.rows[0].ledger_address}`;
  await page.setViewportSize({ width: 1023, height: 1000 });
  await page.goto(path);
  const first = rows(page).first();
  await expect(first).toBeVisible();
  await first.locator("summary").click();
  await expect(first.locator("dt", { hasText: "Spent" })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 1000 });
  await expect(table(page).getByRole("columnheader", { name: "Spent" })).toBeVisible();
});

test("block rows count in the singular for one", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.goto("/blocks");
  await expect(rows(page).first()).toBeVisible();
  const text = (await rows(page).allInnerTexts()).join("\n");
  expect(text).not.toMatch(/\b1 (deposits|withdrawals)\b/);
});
