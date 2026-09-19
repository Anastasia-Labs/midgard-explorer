import { expect, test } from "./helpers";

/**
 * Two accessibility properties automated checks do not cover.
 *
 * axe runs with the `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` tags, none of
 * which include WCAG 2.2, and none of which can tell whether activating a skip
 * link moved focus. Both were recorded as findings on evidence that was read
 * rather than measured, so both are measured here.
 */

test("the skip link moves focus to the main region", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "keyboard behaviour, one viewport");
  await page.goto("/blocks");

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText(/Skip to content/);

  await page.keyboard.press("Enter");

  // The element, not the URL fragment. `#main` in the address bar says the
  // browser scrolled; it says nothing about what is focused, and focus is what
  // a screen reader announces and what the next Tab continues from. Before
  // `tabIndex={-1}` this was `body`.
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  expect(focused, "activating the skip link left focus where it was").toBe("main");
});

/**
 * WCAG 2.2 success criterion 2.5.8 measures the TARGET, which is the region
 * that accepts a pointer action, not the painted glyph. The information
 * triggers paint 16 x 16 px and extend their target with a pseudo-element, so
 * a measurement of `getBoundingClientRect` alone reports a failure that a
 * pointer does not experience. This walks outwards from the centre of a real
 * trigger and asks the document what is under each point.
 */
test("an information trigger accepts a pointer over at least 24 x 24 px", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "measures a pointer target");
  await page.goto("/deposits");
  await page.waitForLoadState("networkidle");

  const measured = await page.evaluate(() => {
    const visible = [...document.querySelectorAll<HTMLElement>("button.rounded-full")].filter(
      (b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top > 8 && r.bottom < window.innerHeight - 8;
      },
    );
    const button = visible[0];
    if (!button) return null;
    const r = button.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const reach = (dx: number, dy: number) => {
      let last = 0;
      for (let d = 1; d <= 40; d += 1) {
        const el = document.elementFromPoint(cx + dx * d, cy + dy * d);
        if (el === button || button.contains(el)) last = d;
        else break;
      }
      return last;
    };
    return {
      painted: { width: Math.round(r.width), height: Math.round(r.height) },
      target: { width: reach(-1, 0) + reach(1, 0), height: reach(0, -1) + reach(0, 1) },
    };
  });

  expect(measured, "no visible information trigger on this page").not.toBeNull();
  expect(measured!.target.width).toBeGreaterThanOrEqual(24);
  expect(measured!.target.height).toBeGreaterThanOrEqual(24);
  // The painted glyph stays small on purpose: it sits inside running text, and
  // a 24 px circle there would shout. Recording both numbers is what keeps the
  // next reader from "fixing" the glyph to satisfy a criterion already met.
  expect(measured!.painted.width).toBeLessThan(24);
});
