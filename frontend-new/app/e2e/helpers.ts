import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const FIXTURE = "http://127.0.0.1:3101";

/** Drives the fixture backend's fault injection. */
export async function inject(page: Page, params: string) {
  const res = await page.request.post(`${FIXTURE}/__control?${params}`);
  expect(res.ok()).toBe(true);
}

/** Waits until the page is visually at rest.
 *
 * Three things move after load and each corrupts a different measurement:
 * the stylesheet (unstyled content overflows horizontally), web fonts (metrics
 * shift), and the 240ms `main > *` fade (sampling mid-fade measures text
 * blended toward the background and reports contrast failures that do not
 * exist at rest). Every visual assertion waits for all three. */
export async function settle(page: Page) {
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue("--mg-bg").trim().length > 0,
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== "running"),
    undefined,
    { timeout: 10_000 },
  );
}

export async function expectNoViolations(page: Page, label: string) {
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations, `${label} has accessibility violations`).toEqual([]);
}

/** Keyboard shortcuts and the theme toggle are registered by client effects, so
 * a keypress fired before hydration is silently dropped. Wait for a control
 * that only exists once React has taken over. */
export async function hydrated(page: Page) {
  await page.getByRole("button", { name: /^Theme:/ }).waitFor({ state: "attached" });
  await page.waitForFunction(() => {
    const b = document.querySelector<HTMLButtonElement>('button[aria-label^="Theme:"]');
    return b !== null && typeof (b as unknown as { onclick: unknown }).onclick !== "undefined";
  });
  await settle(page);
}

/** The search dialog is rendered once per SearchBox variant, so a bare label
 * lookup is ambiguous. Always work inside the dialog that is actually open. */
export function searchInput(page: Page) {
  return page.locator("dialog[open]").getByLabel(/Search by transaction hash/);
}

/** Opens the search overlay via the visible trigger. Below `lg` the header
 * search box is hidden and the icon button is used instead; both open the same
 * dialog, so the visible one is the right target at any viewport. */
export async function openSearch(page: Page) {
  await hydrated(page);
  await page
    .getByRole("button", { name: "Search (Ctrl+K)" })
    .filter({ visible: true })
    .first()
    .click();
  await expect(searchInput(page)).toBeVisible();
}

/** True when the viewport is below Tailwind's `sm` breakpoint, where the
 * desktop table, the network badge and the header search box are all hidden by
 * design and the mobile ledger rows are shown instead. */
export async function isNarrow(page: Page): Promise<boolean> {
  return (page.viewportSize()?.width ?? 1280) < 640;
}

/** Row content as the current viewport actually presents it: the `<table>` on
 * desktop, the prioritized ledger list below `sm`. */
export function rowRegion(page: Page) {
  return page.locator("table, ul.divide-y").filter({ visible: true }).first();
}

export async function firstBlockHash(page: Page): Promise<string> {
  const res = await page.request.get(`${FIXTURE}/api/blocks/1`);
  return (await res.json()).rows[0].header_hash as string;
}

/** Finds the first transaction whose detail response satisfies `matches`.
 *
 * The state has to come from the detail endpoint, not the list: a list row is
 * built from the blocks table, so it reports every transaction it can see as
 * committed, and only the detail response says whether inclusion and a
 * finalization record actually exist. Two pages are scanned because a state
 * that needs a particular lifecycle and a particular settlement stage together
 * may not appear inside the first twenty-five rows.
 */
async function findTx(
  page: Page,
  matches: (body: {
    status: string;
    inclusion: unknown;
    finalization: { status: string } | null;
  }) => boolean,
  describe: string,
  pages = 2,
): Promise<string> {
  for (let p = 1; p <= pages; p++) {
    const rows = await page.request
      .get(`${FIXTURE}/api/transactions/${p}`)
      .then(async (r) => (await r.json()).rows as Array<{ tx_id: string }>);
    for (const row of rows) {
      const detail = await page.request.get(`${FIXTURE}/api/transaction?tx_hash=${row.tx_id}`);
      if (detail.status() !== 200) continue;
      if (matches(await detail.json())) return row.tx_id;
    }
  }
  throw new Error(`no fixture transaction is ${describe}`);
}

export const txWithStatus = (page: Page, status: string): Promise<string> =>
  findTx(page, (b) => b.status === status, `in status ${status}`);

/** Known finalization statuses that mean the block is still moving toward L1.
 * Terminal ones and unrecognized ones are excluded deliberately: each produces
 * a different, correct headline, so neither is the state under test here. */
const IN_FLIGHT_FINALIZATION = new Set([
  "pending_submission",
  "submitted_local_finalization_pending",
  "submitted_unconfirmed",
  "observed_waiting_stability",
]);

/** A committed transaction whose block is still working toward L1. "Committed"
 * alone does not pin the state: the same transaction may sit in a finalized
 * block, an abandoned one, or one whose stage the explorer does not recognize,
 * and each of those is a different headline. */
export const txAwaitingFinality = (page: Page): Promise<string> =>
  findTx(
    page,
    (b) =>
      b.status === "committed" &&
      b.inclusion !== null &&
      b.finalization !== null &&
      IN_FLIGHT_FINALIZATION.has(b.finalization.status),
    "committed and awaiting L1 finality",
  );

/** A committed transaction whose block gave up on settling. Inclusion in an L2
 * block is not the end of the story, and this is the state that proves it. */
export const txInAbandonedBlock = (page: Page): Promise<string> =>
  findTx(
    page,
    (b) => b.status === "committed" && b.finalization?.status === "abandoned",
    "committed inside an abandoned block",
  );
