import type { Locator, Page } from "@playwright/test";
import { FIXTURE, expect, openSearch, rowRegion, searchInput, settle, test } from "./helpers";

/** Task performance, measured instead of asserted.
 *
 * Every score in the design audits so far is a judgement I made about my own
 * work. This file exists to convert one of those judgements into a number that
 * does not depend on who is holding the opinion: for a set of questions a real
 * user actually arrives with, how many actions does the explorer need before
 * the answer is on screen, and is it on screen without scrolling on a phone?
 *
 * What this is not: it is not a usability study. It measures the path a user
 * takes once they know where to go, which is the structural half of task
 * performance. The other half, whether someone unfamiliar finds that path at
 * all, needs people, and no number produced here is a substitute for watching
 * one. Saying so is the point: the gap that remains should be a stated gap
 * rather than an unexamined score.
 *
 * The gates are deliberately loose. They exist to catch a regression that adds
 * a step to a common question, not to certify a target. `TASK_REPORT=1` prints
 * the table for a report.
 */

type TaskResult = {
  task: string;
  /** Discrete user actions: navigations, clicks, typed submissions. */
  steps: number;
  /** Milliseconds from the first action to the answer being visible. */
  ms: number;
  /** Whether the answer sat in the first 844px at phone width. */
  aboveFold: boolean | null;
};

const results: TaskResult[] = [];

/** Runs one task, timing from the first action to the answer being visible. */
async function measureTask(
  page: Page,
  task: string,
  steps: number,
  run: () => Promise<Locator>,
): Promise<TaskResult> {
  const started = Date.now();
  const answer = await run();
  await expect(answer).toBeVisible();
  const ms = Date.now() - started;

  // Above the fold is only meaningful at a known viewport height, and the
  // phone is the one where it is scarce.
  const viewport = page.viewportSize();
  let aboveFold: boolean | null = null;
  if (viewport) {
    const box = await answer.boundingBox();
    aboveFold = box === null ? null : box.y + box.height <= viewport.height;
  }

  const result = { task, steps, ms, aboveFold };
  results.push(result);
  return result;
}

test.describe("task performance", () => {
  test.slow();

  test.afterAll(() => {
    if (!process.env.TASK_REPORT) return;
    const rows = results.map(
      (r) =>
        `| ${r.task} | ${r.steps} | ${r.ms} | ${
          r.aboveFold === null ? "n/a" : r.aboveFold ? "yes" : "no"
        } |`,
    );
    console.log(
      [
        "",
        "| Task | Steps | ms to answer | Above the fold |",
        "|---|---:|---:|---|",
        ...rows,
        "",
      ].join("\n"),
    );
  });

  test('"is the network healthy right now?"', async ({ page }) => {
    // The question an operator opens an explorer with. One navigation, and the
    // answer is a sentence rather than five figures to add up.
    const r = await measureTask(page, "Is the network healthy?", 1, async () => {
      await page.goto("/");
      await settle(page);
      return page.locator('[data-region="verdict"]');
    });
    expect(
      r.steps,
      "the network's state should not need more than one navigation",
    ).toBeLessThanOrEqual(1);
    if (await page.viewportSize()) expect(r.aboveFold).not.toBe(false);
  });

  test('"did my transaction go through?"', async ({ page }) => {
    const hash = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows[0].tx_id as string);

    // Land, search, read. Three actions is the floor for a lookup a user
    // arrives with a hash for, and the answer must be the headline, not a
    // status code the reader has to interpret.
    const r = await measureTask(page, "Did my transaction go through?", 3, async () => {
      await page.goto("/");
      await openSearch(page);
      const input = searchInput(page);
      await input.fill(hash);
      await input.press("Enter");
      await page.waitForURL(new RegExp(`/transaction/${hash}$`));
      // The answer is the record header's badge. It used to be the journey's
      // own heading, one of three places this page stated a lifecycle.
      return page.locator('[data-region="identity"]').getByText(/Committed|Final on Cardano/);
    });
    expect(r.steps).toBeLessThanOrEqual(3);
  });

  test('"is this block final on Cardano?"', async ({ page }) => {
    // Scoped to the row region rather than the page: `getByRole("link")` on
    // the page also matches the skip link and the nav, and below `sm` the
    // desktop table is replaced by ledger rows that truncate hashes
    // differently, so matching on a hash prefix is viewport-dependent. The
    // task is "open the first block in the list", so express that.
    const r = await measureTask(page, "Is this block final on L1?", 2, async () => {
      await page.goto("/blocks");
      await rowRegion(page).getByRole("link").first().click();
      await page.waitForURL(/\/block\/[0-9a-f]{56}/);
      return page.getByRole("region", { name: "Protocol journey" }).getByRole("heading", {
        level: 2,
      });
    });
    expect(r.steps).toBeLessThanOrEqual(2);
  });

  test('"what does this address hold?"', async ({ page }) => {
    const address = await page.request
      .get(`${FIXTURE}/api/deposits/1`)
      .then(async (r) => (await r.json()).rows[0].ledger_address as string);

    const r = await measureTask(page, "What does this address hold?", 3, async () => {
      await page.goto("/");
      await openSearch(page);
      const input = searchInput(page);
      await input.fill(address);
      await input.press("Enter");
      await page.waitForURL(new RegExp("/address/"));
      return page.locator("dl").first();
    });
    expect(r.steps).toBeLessThanOrEqual(3);
  });

  test('"what is this asset and who holds it?"', async ({ page }) => {
    const r = await measureTask(page, "What is this asset?", 2, async () => {
      await page.goto("/assets");
      await rowRegion(page).getByRole("link").first().click();
      await page.waitForURL(/\/asset\//);
      return page.getByRole("heading", { level: 1 });
    });
    expect(r.steps).toBeLessThanOrEqual(2);
  });
});
