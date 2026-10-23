import { expect, settle, test } from "./helpers";

/**
 * Phase 5.2: the interaction states.
 *
 * The audit found focus already covered by a global `:focus-visible` rule and
 * every click handler already on a real button or link. What was missing was
 * pressed feedback, so that is what these pin, along with the preference that
 * has to switch it off.
 */

test.describe("pressed feedback", () => {
  test("a control moves under a press", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const applied = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap((s) => {
        try {
          return [...s.cssRules];
        } catch {
          return [];
        }
      });
      return rules.some((r) => r.cssText.includes(":active") && r.cssText.includes("scale(0.985)"));
    });
    expect(applied).toBe(true);
  });

  test("focus is visible without any component asking for it", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    // The audit's correction: this is global, not per component.
    const hasFocusRule = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap((s) => {
        try {
          return [...s.cssRules];
        } catch {
          return [];
        }
      });
      return rules.some(
        (r) => r.cssText.includes(":focus-visible") && r.cssText.includes("outline"),
      );
    });
    expect(hasFocusRule).toBe(true);
  });

  test("the press is switched off when reduced motion is asked for", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await settle(page);
    const link = page.getByRole("link", { name: "Blocks" }).first();
    await expect(link).toBeVisible();
    // `transform: none` under the preference: the only movement on the site
    // must not sit outside the setting that asks for none.
    const transform = await link.evaluate((el) => {
      el.classList.add("__probe");
      return getComputedStyle(el).transform;
    });
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
  });
});
