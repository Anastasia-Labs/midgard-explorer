import { expect, expectNoViolations, settle, test } from "./helpers";

/** Phase 2.6: the standalone utilities.
 *
 * These run entirely in the browser, so unlike every other page they work with
 * the backend down. That is worth asserting: it is the reason they earn their
 * place beside the explorer rather than inside it. */

test.describe("tools", () => {
  test("decodes a pasted CBOR payload", async ({ page }) => {
    await page.goto("/tools");
    await settle(page);

    // 0x83 01 02 03 is the CBOR array [1, 2, 3].
    await page.getByLabel("CBOR hex", { exact: true }).fill("83010203");
    await expect(page.getByRole("region", { name: "Decoded CBOR" })).toContainText("[");
    await expect(page.getByRole("region", { name: "Decoded CBOR" })).toContainText("3");
  });

  test("explains bad input rather than failing silently", async ({ page }) => {
    await page.goto("/tools");
    await settle(page);

    await page.getByLabel("CBOR hex", { exact: true }).fill("nothex");
    await expect(page.getByRole("status").filter({ hasText: /hex/i }).first()).toBeVisible();
  });

  test("converts lovelace to ada at full precision", async ({ page }) => {
    await page.goto("/tools");
    await settle(page);

    await page.getByLabel("Lovelace", { exact: true }).fill("45000000000000000");
    await expect(page.getByRole("status").filter({ hasText: "45000000000" }).first()).toBeVisible();
  });

  test("splits an asset unit into policy and name", async ({ page }) => {
    await page.goto("/tools");
    await settle(page);

    await page.getByLabel("Unit", { exact: true }).fill(`${"ab".repeat(28)}4d4944`);
    await expect(page.getByRole("status").filter({ hasText: "ab".repeat(28) })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "4d4944" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^MID$/ })).toBeVisible();
  });

  test("works with the backend unreachable, because nothing here needs it", async ({ page }) => {
    await page.route("**/api/**", (route) => route.abort());
    await page.goto("/tools");
    await settle(page);

    await page.getByLabel("CBOR hex", { exact: true }).fill("01");
    await expect(page.getByRole("region", { name: "Decoded CBOR" })).toContainText("1");
  });

  test("is reachable from the footer", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await expect(page.getByRole("link", { name: "Tools", exact: true })).toBeVisible();
  });

  test("has no automated violations in either theme", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/tools");
      await settle(page);
      // Audit with content on screen, not only the empty form.
      await page.getByLabel("CBOR hex", { exact: true }).fill("83010203");
      await expectNoViolations(page, `/tools (${scheme})`);
    }
  });
});
