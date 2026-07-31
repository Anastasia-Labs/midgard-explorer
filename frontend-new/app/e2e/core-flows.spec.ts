import { expect, test } from "@playwright/test";
import {
  FIXTURE,
  expectNoViolations,
  hydrated,
  inject,
  isNarrow,
  openSearch,
  searchInput,
  settle,
} from "./helpers";

test.afterEach(async ({ page }) => {
  await inject(page, "fail=&slow=0");
});

const ROUTES = [
  ["/", "Network overview"],
  ["/blocks", "Blocks"],
  ["/transactions", "Transactions"],
  ["/deposits", "Deposits"],
  ["/withdrawals", "Withdrawals"],
  ["/forced-transactions", "Forced transactions"],
] as const;

test.describe("shell and navigation", () => {
  for (const [path, heading] of ROUTES) {
    test(`${path} renders its heading`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    });
  }

  test("skip link is the first thing keyboard focus reaches", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  });

  test("the network badge names the deployment rather than guessing", async ({ page }) => {
    await page.goto("/");
    // The badge is `hidden sm:inline-flex`: below sm it is deliberately absent
    // rather than wrong, so assert on presence in the DOM either way.
    const badge = page.getByText("Fixture", { exact: true }).first();
    if (await isNarrow(page)) await expect(badge).toBeAttached();
    else await expect(badge).toBeVisible();
    await expect(page.getByText("Network not configured")).toHaveCount(0);
  });

  test("theme toggle flips the effective theme and persists it", async ({ page }) => {
    await page.goto("/");
    await hydrated(page);
    await page.getByRole("button", { name: /^Theme:/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
    const chosen = await page.locator("html").getAttribute("data-theme");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", chosen!);
  });
});

test.describe("search", () => {
  // The Ctrl+K and "/" handlers belong to the header SearchBox, which only
  // renders at lg and above. Below that the icon button is the entry point.
  test("opens with the keyboard shortcut and routes a transaction hash", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) < 1024, "header search box is lg and up");
    await page.goto("/");
    const hash = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows[0].tx_id as string);
    await hydrated(page);
    await page.keyboard.press("ControlOrMeta+k");
    const input = searchInput(page);
    await expect(input).toBeVisible();
    await input.fill(hash);
    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/transaction/${hash}$`));
  });

  test("opens with the / shortcut", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) < 1024, "header search box is lg and up");
    await page.goto("/");
    await hydrated(page);
    await page.keyboard.press("/");
    await expect(searchInput(page)).toBeVisible();
  });

  test("explains a wrong-length hex value instead of navigating", async ({ page }) => {
    await page.goto("/");
    await openSearch(page);
    const input = searchInput(page);
    await input.fill("a".repeat(60));
    await input.press("Enter");
    await expect(page.locator("dialog[open]").getByRole("alert")).toContainText("60");
    await expect(page).toHaveURL("/");
  });

  test("rejects an address with a bad checksum in place", async ({ page }) => {
    await page.goto("/");
    await openSearch(page);
    const input = searchInput(page);
    await input.fill("addr_test1qqqqqqqqqqqqqqqqqqqqqqqqqqqqq");
    await input.press("Enter");
    await expect(page.locator("dialog[open]").getByRole("alert")).toContainText(
      /checksum|invalid characters/i,
    );
  });

  test("tolerates a pasted value with surrounding whitespace", async ({ page }) => {
    await page.goto("/");
    const hash = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows[0].tx_id as string);
    await openSearch(page);
    const input = searchInput(page);
    await input.fill(`  ${hash}  `);
    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/transaction/${hash}$`));
  });
});

test.describe("degraded states", () => {
  test("a failing overview reports it without blanking the page", async ({ page }) => {
    await inject(page, "fail=all");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Network overview" })).toBeVisible();
    await expect(page.getByText("Unavailable").first()).toBeVisible();
  });

  test("a failing list page offers a retry", async ({ page }) => {
    await inject(page, "fail=all");
    await page.goto("/blocks");
    // Scoped to main: Next renders its own empty role="alert" route announcer.
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("internal error");
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("an unknown transaction hash renders the not-found page", async ({ page }) => {
    await page.goto(`/transaction/${"f".repeat(64)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  test("a malformed identifier renders the not-found page", async ({ page }) => {
    await page.goto("/block/not-a-hash");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  // DEFECT (found 2026-07-30, production build): notFound() inside these dynamic
  // routes renders the not-found page but responds HTTP 200. Only an unmatched
  // path (/nonexistent-page) returns a real 404. Search engines and uptime
  // checks cannot tell an invalid identifier from a valid page.
  test.fixme("a malformed identifier responds with HTTP 404", async ({ page }) => {
    const res = await page.goto("/block/not-a-hash");
    expect(res?.status()).toBe(404);
  });

  test.fixme("an unknown transaction hash responds with HTTP 404", async ({ page }) => {
    const res = await page.goto(`/transaction/${"f".repeat(64)}`);
    expect(res?.status()).toBe(404);
  });

  test("a genuinely unmatched path still returns 404", async ({ page }) => {
    const res = await page.goto("/no-such-route");
    expect(res?.status()).toBe(404);
  });
});

test.describe("pagination", () => {
  test("moves between pages and marks the current one", async ({ page }) => {
    await page.goto("/blocks");
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByLabel("Page 2")).toHaveAttribute("aria-current", "page");
  });

  test("the legacy path form redirects to the query form", async ({ page }) => {
    await page.goto("/blocks/2");
    await expect(page).toHaveURL(/\/blocks\?page=2$/);
  });

  test("a junk path segment redirects to the first page", async ({ page }) => {
    await page.goto("/deposits/not-a-number");
    await expect(page).toHaveURL(/\/deposits$/);
  });
});

test.describe("accessibility", () => {
  for (const [path] of ROUTES) {
    test(`${path} has no automated violations`, async ({ page }) => {
      await page.goto(path);
      await expectNoViolations(page, path);
    });
  }

  test("no horizontal overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    for (const [path] of ROUTES) {
      await page.goto(path);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      await settle(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows horizontally at 320px`).toBe(false);
    }
  });
});
