import { expect, inject, isNarrow, rowRegion, test } from "./helpers";

/** The state queue on the Blocks page: drawn in linked order, kept current by
 * polling, and moved rather than redrawn when the node's queue changes. */

const queue = (page: import("@playwright/test").Page) =>
  page.locator('[data-region="state-queue"]');

const keys = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-queue-key]")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => el.dataset.queueKey!),
  );

test("draws the queue from the confirmed state to the newest header", async ({ page }) => {
  await page.goto("/blocks");
  const q = queue(page);
  await expect(q.getByText("16 waiting to merge")).toBeVisible();
  for (const caption of ["Confirmed state", "Next to merge", "Newest"]) {
    await expect(q.getByText(caption, { exact: true })).toBeVisible();
  }
  // A phone shows only the ends, so everything between folds into one count.
  await expect(
    q.getByText((await isNarrow(page)) ? "14 more" : "4 more", { exact: true }),
  ).toBeVisible();
  await expect(rowRegion(page)).toBeVisible();
});

test("moves cards when the node's queue moves", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __queueMoves: number };
    w.__queueMoves = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if ((this as HTMLElement).dataset?.queueKey) w.__queueMoves++;
      return animate.apply(this, args);
    };
  });
  await inject(page, "queue=live");
  // Waits on real fixture ticks of six seconds.
  test.slow();
  await page.goto("/blocks");
  // Measured once the queue is drawn: before layout every card has no box, and
  // the first drawing would read as a change that moved nothing.
  await expect(queue(page).getByText("Confirmed state", { exact: true })).toBeVisible();
  await expect.poll(async () => (await keys(page)).length).toBeGreaterThan(0);
  const before = await keys(page);
  // A commit lands every two ticks and a header merges every three.
  await expect.poll(() => keys(page), { timeout: 30_000 }).not.toEqual(before);
  const moves = await page.evaluate(
    () => (window as unknown as { __queueMoves: number }).__queueMoves,
  );
  expect(moves).toBeGreaterThan(0);
});

test("says Unavailable when the queue cannot be read, and keeps the list", async ({ page }) => {
  await inject(page, "fail=state-queue");
  await page.goto("/blocks");
  await expect(queue(page).getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(queue(page).getByText(/waiting to merge/)).toHaveCount(0);
  await expect(rowRegion(page)).toBeVisible();
});
