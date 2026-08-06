import { expect, expectNoViolations, settle, test } from "./helpers";

/** Phase 0: no explanation in the explorer may be hover-only.
 *
 * `title=` was reachable by mouse alone. These tests fail if the help text goes
 * back behind a hover, or if it is present in the DOM but unreachable from the
 * keyboard, which a unit test asserting component internals would not catch.
 * The `react/forbid-dom-props` lint rule covers the attribute; this covers the
 * behaviour a user actually gets. */

test.describe("help text is reachable without a mouse", () => {
  test("no rendered page carries a hover-only title attribute", async ({ page }) => {
    for (const path of ["/", "/transactions", "/blocks", "/withdrawals", "/deposits"]) {
      await page.goto(path);
      await settle(page);
      const hoverOnly = await page.evaluate(() =>
        [...document.querySelectorAll("[title]")].map(
          (el) => `${el.tagName.toLowerCase()}[title="${el.getAttribute("title")}"]`,
        ),
      );
      expect(hoverOnly, `hover-only help found on ${path}`).toEqual([]);
    }
  });

  test("a status explanation opens on click and closes on Escape", async ({ page }) => {
    await page.goto("/transactions");
    await settle(page);

    const trigger = page.getByRole("button", { name: /^About / }).first();
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    const tip = page.getByRole("tooltip");
    await expect(tip).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // The open tip must be what describes the trigger, not a detached node.
    const describedBy = await trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveText(/\S/);

    await trigger.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("a keyboard user reaches the explanation by focus alone", async ({ page }) => {
    await page.goto("/transactions");
    await settle(page);

    const trigger = page.getByRole("button", { name: /^About / }).first();
    await trigger.focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
  });

  test("the trigger meets the minimum target size", async ({ page }) => {
    await page.goto("/transactions");
    await settle(page);

    const trigger = page.getByRole("button", { name: /^About / }).first();
    // The glyph is 16px; a pseudo-element carries the rest of the target, so
    // measure what a pointer actually hits rather than the box.
    const reach = await trigger.evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      const box = el.getBoundingClientRect();
      const inset = Math.abs(parseFloat(after.insetBlockStart || "0"));
      return { width: box.width + inset * 2, height: box.height + inset * 2 };
    });
    expect(reach.width).toBeGreaterThanOrEqual(44);
    expect(reach.height).toBeGreaterThanOrEqual(44);
  });

  test("an open tip is clean in both themes", async ({ page }) => {
    const background: Record<string, string> = {};

    // The shared both-themes helper navigates, which would close the tip. The
    // point here is to audit the tip while it is open, so drive it directly.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/transactions");
      await settle(page);
      await page
        .getByRole("button", { name: /^About / })
        .first()
        .click();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await expectNoViolations(page, `open InfoTip (${scheme})`);
      background[scheme] = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--mg-bg").trim(),
      );
    }

    expect(
      background.light,
      "both passes rendered the same background, so only one theme was audited",
    ).not.toBe(background.dark);
  });
});
