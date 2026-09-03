import { expect, test, FIXTURE } from "./helpers";
import type { APIRequestContext } from "@playwright/test";

/**
 * What the explorer says about Cardano, in a browser, for every verdict.
 *
 * The resolver has unit tests and the panel has component tests, and neither
 * proves a reader ever sees the result: the panel could be unmounted, hidden
 * behind a tab, or handed an undefined field, and both suites would stay green.
 * That is the same gap that let a broken block key ship, where every gate read
 * one source and none read the page.
 *
 * The two rules asserted here are the ones the product rests on. A
 * disagreement shows BOTH hashes, because showing one would hide the finding.
 * And an index that is merely behind is described as behind, never as a denial,
 * because the interface used to report a defect as index lag for as long as the
 * defect existed.
 *
 * The block for each verdict is DISCOVERED rather than hard-coded. A first
 * version of this file computed the fixture's hashes by reimplementing its
 * generator, got the block numbering wrong, and asserted "no settlement" against
 * a block the fixture had settled. Asking the fixture which block is in which
 * state cannot drift from the fixture, and survives it being renumbered.
 */

type State = "matched" | "mismatch" | "stale" | "unavailable" | "node_only" | "none";

let discovered: Map<State, string> | null = null;

async function blocksByState(request: APIRequestContext): Promise<Map<State, string>> {
  if (discovered) return discovered;
  const found = new Map<State, string>();
  for (const page of [1, 2]) {
    const list = await request.get(`${FIXTURE}/api/blocks/${page}`);
    if (!list.ok()) break;
    const { rows } = (await list.json()) as { rows: Array<{ header_hash: string }> };
    for (const row of rows) {
      const detail = await request.get(`${FIXTURE}/api/block?header_hash=${row.header_hash}`);
      if (!detail.ok()) continue;
      const body = (await detail.json()) as { cardano?: { reconciliation?: State } };
      const state = body.cardano?.reconciliation;
      if (state && !found.has(state)) found.set(state, row.header_hash);
    }
  }
  discovered = found;
  return found;
}

/** Navigates to a block in the given state, or fails saying the fixture cannot
 * produce it. A silent skip here would let the fixture lose a state and take
 * this whole file quietly out of service. */
async function gotoState(page: import("@playwright/test").Page, state: State) {
  const byState = await blocksByState(page.request);
  const hash = byState.get(state);
  expect(hash, `the fixture produces no block in state "${state}"`).toBeTruthy();
  await page.goto(`/block/${hash}`);
}

test("the fixture can produce every verdict the panel renders", async ({ page }) => {
  const byState = await blocksByState(page.request);
  expect([...byState.keys()].sort()).toEqual(
    ["matched", "mismatch", "node_only", "none", "stale", "unavailable"].sort(),
  );
});

test("a settled block reports agreement between two sources", async ({ page }) => {
  await gotoState(page, "matched");
  await expect(page.getByText("Confirmed by two independent sources")).toBeVisible();
  await expect(page.getByText("Block settlement").first()).toBeVisible();
});

/**
 * The rule that survives a disagreement. Both observations are rendered and no
 * single hash is offered as the answer, because a page that showed one would be
 * choosing a winner the API deliberately refuses to choose.
 */
test("a disagreement shows both sources", async ({ page }) => {
  await gotoState(page, "mismatch");
  await expect(page.getByText("The two sources disagree")).toBeVisible();
  // Exact, because "Midgard node" is also a substring of the page's own
  // tooltip copy. Playwright's strict mode caught the looser matcher, which is
  // the tool doing its job: an assertion that matches two different elements
  // is not asserting what it appears to.
  await expect(page.getByText("Midgard node", { exact: true })).toBeVisible();
  await expect(page.getByText("Explorer's Cardano index", { exact: true })).toBeVisible();
});

/**
 * The inversion this replaces. The block page printed "the explorer-owned
 * Cardano index has not attributed its Cardano commitment transaction" for
 * every absence, including blocks the index had attributed perfectly.
 *
 * The wording no longer names lag as the cause. It used to say "that is index
 * lag" for every one-sided result, including one from an index reporting itself
 * live, where lag is not an available explanation. What must hold in every case
 * is the narrower claim: an absence is not a denial.
 */
test("an index that is behind is described as behind, not as a denial", async ({ page }) => {
  await gotoState(page, "node_only");
  await expect(page.getByText(/not evidence that settlement did not happen/i)).toBeVisible();
});

test("an index too far behind to compare says so rather than claiming a mismatch", async ({
  page,
}) => {
  await gotoState(page, "stale");
  await expect(page.getByText(/too far behind to compare/i)).toBeVisible();
});

test("an unreadable index says nothing about whether settlement happened", async ({ page }) => {
  await gotoState(page, "unavailable");
  await expect(page.getByText(/says nothing about whether settlement happened/i)).toBeVisible();
});

test("a block with no settlement attempt says that plainly", async ({ page }) => {
  await gotoState(page, "none");
  await expect(page.getByText("No Cardano settlement yet")).toBeVisible();
});

/**
 * Settlement travels through the block, and many transactions share one
 * commitment. The transaction page must show the BLOCK's settlement
 * transaction and never imply this transaction exists on Cardano.
 */
test("a transaction reports the settlement of the block that carries it", async ({ page }) => {
  await page.goto("/transactions");
  const first = page.locator('a[href^="/transaction/"]:visible').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/transaction\/[0-9a-f]{64}$/);
  await expect(page.getByText("Settled through its block")).toBeVisible();
});

/**
 * Settlement references stay inside the explorer.
 *
 * The panel's job is the RELATIONSHIP between a Midgard block and the Cardano
 * transaction that settled it, and the explorer has its own page for that
 * transaction showing what the index observed. Sending the reader straight out
 * to cexplorer.io would drop exactly the cross-layer context the panel exists
 * to provide.
 *
 * Deliberately not a claim about the whole page. The bridge tables link their
 * Cardano references directly to cexplorer.io, which `l1-transaction.spec.ts`
 * pins, and that is a separate and older decision. An earlier version of this
 * test asserted the two rules at once and they cannot both hold.
 */
test("the association panel keeps settlement references inside the explorer", async ({ page }) => {
  // Straight to a block known to be `matched`, using the helper the rest of this
  // file uses. Clicking the first row of /blocks made the case depend on the
  // list rendering, on which block happened to be first, and on a navigation
  // that under load did not always complete: the failure snapshot showed the
  // page still on /blocks, so the assertion was reporting a navigation problem
  // as a missing link.
  await gotoState(page, "matched");

  const panel = page
    .getByRole("heading", { name: "Cardano", exact: true })
    .locator("..")
    .locator("..");
  const settlement = panel.locator('a[href^="/l1/transaction/"]');
  await expect(settlement.first()).toBeVisible();
  await expect(
    panel.locator('a[href*="cexplorer.io"], a[href*="cardanoscan.io"]'),
    "the association panel sent a reader out to a live explorer",
  ).toHaveCount(0);
});
