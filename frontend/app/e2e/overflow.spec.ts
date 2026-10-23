import { expect, test } from "./helpers";

/**
 * No list route scrolls the page sideways.
 *
 * B2 in the readiness audit: at 1280 x 800, the width the desktop project
 * itself uses, `/deposits` pushed the document 106 px past the viewport and
 * `/withdrawals` 195 px. The assertion that should have caught it existed and
 * was not vacuous; it ran at 1440 px, where the tables fit, and at 320 px,
 * where the tables are replaced by a list. The suite's own default width was
 * asserted nowhere.
 *
 * So this measures at the widths a reader actually uses, on every table route,
 * in both themes. A table wider than its column is allowed to scroll INSIDE
 * its own container, which is what `overflow-x: auto` is for. What is not
 * allowed is the document scrolling, because that moves the header, the
 * navigation and every other page out from under the reader.
 */

const ROUTES = [
  "/blocks",
  "/transactions",
  "/deposits",
  "/withdrawals",
  "/forced-transactions",
  "/assets",
  "/l1",
];

/** Widths that mean something: the desktop project's own, a small laptop, a
 * large phone, and one wide enough that nothing should ever overflow. */
const WIDTHS = [
  { width: 1280, height: 800, name: "1280" },
  { width: 1024, height: 800, name: "1024" },
  { width: 390, height: 844, name: "390" },
  { width: 1600, height: 900, name: "1600" },
];

for (const theme of ["light", "dark"] as const) {
  for (const { width, height, name } of WIDTHS) {
    test(`no sideways page scroll at ${name} px in ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "sets its own viewports");
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme });

      const overflowing: string[] = [];
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const over = await page.evaluate(() => {
          const el = document.documentElement;
          return el.scrollWidth - el.clientWidth;
        });
        if (over > 0) overflowing.push(`${route} by ${over}px`);
      }
      expect(overflowing, `pages scroll sideways at ${name}px`).toEqual([]);
    });
  }
}

/**
 * The scroll container still scrolls.
 *
 * Bounding a container so `overflow-x: auto` engages is one `min-width` away
 * from bounding it so the table is clipped instead. A table whose content is
 * wider than the column must still be reachable by scrolling it, so this
 * asserts the container can scroll rather than that it does: at a width where
 * everything fits, a scrollable container correctly has nothing to scroll.
 */
test("a table too wide for its column scrolls inside its own container", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "sets its own viewport");
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/withdrawals");
  await page.waitForLoadState("networkidle");

  const measured = await page.evaluate(() => {
    const scroller = document.querySelector(".overflow-x-auto");
    if (scroller === null) return null;
    const style = getComputedStyle(scroller);
    return {
      overflowX: style.overflowX,
      // Wider content than box means it scrolls; equal means it fits. Both are
      // correct. A box wider than the viewport is the defect.
      boxWidth: scroller.clientWidth,
      contentWidth: scroller.scrollWidth,
      viewport: document.documentElement.clientWidth,
    };
  });

  expect(measured, "no scroll container on the withdrawals table").not.toBeNull();
  expect(measured!.overflowX).toBe("auto");
  expect(measured!.boxWidth).toBeLessThanOrEqual(measured!.viewport);
});
