import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

/** Derived from the same variable `playwright.config.ts` uses to start the
 * fixture. Hard-coding it here meant `FIXTURE_PORT=…` started a fixture on one
 * port while every helper talked to another, so the suite silently tested
 * whatever else happened to be listening on 3101. */
export const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3101);
export const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;

/** Drives the fixture backend's fault injection. */
export async function inject(page: Page, params: string) {
  const res = await page.request.post(`${FIXTURE}/__control?${params}`);
  expect(res.ok()).toBe(true);
}

/** Every test starts and ends against a fixture with no injected faults.
 *
 * `reuseExistingServer` is on outside CI, so a run that was interrupted after
 * injecting `fail=all` leaves a poisoned server behind and the next run adopts
 * it. The symptom is a handful of degraded-state tests failing on one machine
 * and passing on another, which makes the suite useless as a gate. Resetting on
 * the way in as well as out means an inherited server heals itself, and a
 * single missing `afterEach` in one spec file can no longer corrupt another.
 *
 * Import `test` from here rather than from `@playwright/test` so this cannot be
 * forgotten in a new spec file. */
export const test = base.extend<{ cleanFixture: void }>({
  cleanFixture: [
    async ({ request }, use) => {
      await request.post(`${FIXTURE}/__control?fail=&slow=0`);
      await use();
      await request.post(`${FIXTURE}/__control?fail=&slow=0`);
    },
    { auto: true },
  ],
});

export { expect };

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

/** Audits a route under both colour schemes, and proves they differed.
 *
 * The theme follows `prefers-color-scheme`, and Playwright emulates `light`
 * unless told otherwise. So a suite that never calls `emulateMedia` audits the
 * light theme on every route and the dark theme on none, while looking exactly
 * like a suite that covers both. That is what happened here: a report claimed
 * "both themes" on the strength of a single test whose only distinguishing act
 * was to request the scheme that was already in effect.
 *
 * Running both is half the fix. The other half is the assertion at the end:
 * if the two passes render the same background, this audited one theme twice
 * and must fail rather than report a pass for a theme it never loaded. */
export async function expectNoViolationsInBothThemes(page: Page, path: string) {
  const background: Record<string, string> = {};

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(path);
    await expectNoViolations(page, `${path} (${scheme})`);
    background[scheme] = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--mg-bg").trim(),
    );
  }

  expect(
    background.light,
    `${path}: the light and dark passes both rendered ${background.light}, ` +
      `so only one theme was actually audited`,
  ).not.toBe(background.dark);
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
    transaction?: {
      inputs: Array<{ resolved: unknown | null }>;
      witnesses?: { redeemers?: unknown[] };
    } | null;
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

export const txWithUnresolvedInput = (page: Page): Promise<string> =>
  findTx(
    page,
    (body) =>
      body.status === "committed" &&
      body.transaction !== null &&
      body.transaction !== undefined &&
      body.transaction.inputs.some((input) => input.resolved === null),
    "committed with an unresolved input",
  );

/** A transaction that ran no scripts. The Events tab has to be honest about
 * this case as well as the populated one: most transfers invoke nothing, and a
 * tab that only ever gets exercised with invocations would not notice if the
 * empty state started claiming something it should not. */
export const txWithoutInvocations = (page: Page): Promise<string> =>
  findTx(
    page,
    (body) =>
      body.status === "committed" &&
      body.transaction !== null &&
      body.transaction !== undefined &&
      (body.transaction.witnesses?.redeemers ?? []).length === 0,
    "committed with no redeemers",
  );

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
