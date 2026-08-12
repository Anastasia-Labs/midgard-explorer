import { FIXTURE, expect, settle, test, txWithStatus } from "./helpers";

/**
 * Marks that carry meaning the text does not.
 *
 * The explorer already gives every record type a glyph. These cover the places
 * that state a condition rather than name a record, where the page had colour
 * or nothing at all as its only channel:
 *
 *   - a link that leaves the site, which looked identical to one that does not
 *   - an empty table body, which read as a broken one
 *   - a callout, whose five tones were separated by border colour alone
 *
 * Every mark here is decorative. None of them is allowed to be the only way to
 * learn the thing: the words stay, and these tests check the words are still
 * reachable alongside the glyph.
 */

test.describe("a link that leaves the site says so", () => {
  test("marks every external link in the footer", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const external = page.getByRole("contentinfo").locator('a[target="_blank"]');
    const n = await external.count();
    // The footer links to the protocol site and the source repository. If that
    // ever drops to zero this test is passing on an empty set.
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(external.nth(i).locator("svg")).toBeAttached();
    }
  });

  test("names the destination in words, not in the glyph", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const link = page.getByRole("contentinfo").getByRole("link", { name: /About Midgard/i });
    await expect(link).toBeVisible();
    // The accessible name must still be the words. A glyph that swallowed the
    // label would leave a screen reader with "link, graphic".
    await expect(link).toHaveAccessibleName(/About Midgard/i);
  });
});

test.describe("an empty table is marked as empty", () => {
  test("shows a mark beside the headline, not a bare paragraph", async ({ page }) => {
    // A page number past the end of the list. Reachable by typing a URL and by
    // following a stale link, and the only empty list the fixture chain has.
    await page.goto("/deposits?page=99");
    await settle(page);
    const empty = page.getByText(/No deposits/i).first();
    await expect(empty).toBeVisible();
    await expect(empty.locator("xpath=..").locator("svg")).toBeAttached();
  });
});

test.describe("transaction concepts keep one semantic glyph", () => {
  test("marks L2 credentials, UTxOs, protocol availability, and consumed outputs", async ({
    page,
  }) => {
    const hash = await txWithStatus(page, "committed");
    await page.goto(`/transaction/${hash}?tab=utxo`);
    await settle(page);
    await expect(page.locator('[data-semantic-icon="input"]').first()).toBeVisible();
    await expect(page.locator('[data-semantic-icon="output"]').first()).toBeVisible();
    await page.getByText("Credentials").first().click();
    await expect(page.locator('[data-semantic-icon="paymentCredential"]').first()).toBeVisible();
    await expect(page.locator('[data-semantic-icon="stakeCredential"]').first()).toBeVisible();

    await page.getByRole("tab", { name: "Details" }).click();
    for (const kind of [
      "collateral",
      "metadata",
      "protocolEvent",
      "executionTrace",
      "consumedBy",
    ]) {
      await expect(page.locator(`[data-semantic-icon="${kind}"]:visible`).first()).toBeVisible();
    }
  });

  test("uses the same marks in Cardano L1 detail", async ({ page }) => {
    const rows = await page.request
      .get(`${FIXTURE}/api/l1/transactions/1`)
      .then(async (response) => (await response.json()).rows as Array<{ txHash: string }>);
    await page.goto(`/l1/transaction/${rows[0]!.txHash}?tab=utxos`);
    await settle(page);
    for (const kind of ["input", "referenceInput", "output", "paymentCredential", "datum"]) {
      await expect(page.locator(`[data-semantic-icon="${kind}"]`).first()).toBeVisible();
    }
    await page.getByRole("tab", { name: /Collateral/ }).click();
    await expect(page.locator('[data-semantic-icon="collateral"]').first()).toBeVisible();
    await page.getByRole("tab", { name: /Mint \/ burn/ }).click();
    await expect(page.locator('[data-semantic-icon="mintBurn"]').first()).toBeVisible();
  });
});
