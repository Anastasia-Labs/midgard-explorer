import { expect, test, FIXTURE } from "./helpers";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * What a reader sees about settlement, given one source.
 *
 * The resolver proves the verdict and the panel tests prove the wording, and
 * neither proves a browser ever shows it: the panel can be unmounted, hidden
 * behind a tab, or gated on a value that no longer arrives. The transaction
 * page gated three placements on `matched`, so a change of shape silently moved
 * a notice, dropped the evidence panel and changed a label, and every unit
 * suite stayed green.
 *
 * The explorer reads the Midgard node and nothing else. It used to also keep a
 * Cardano index, and a separate spec tested the seven verdicts that arose from
 * comparing the two; the index is decommissioned, and this file is what is left
 * to prove: every wording names the node, and an empty record never reads as
 * evidence.
 *
 * Records are DISCOVERED by their verdict rather than named here, so the fixture
 * can renumber its blocks without quietly taking this file out of service.
 */

type Verdict = "node_reported" | "none";

let blocks: Map<Verdict, string> | null = null;

async function blocksByVerdict(request: APIRequestContext): Promise<Map<Verdict, string>> {
  if (blocks) return blocks;
  const found = new Map<Verdict, string>();
  for (const p of [1, 2]) {
    const list = await request.get(`${FIXTURE}/api/blocks/${p}`);
    if (!list.ok()) break;
    const { rows } = (await list.json()) as { rows: Array<{ header_hash: string }> };
    for (const row of rows) {
      const detail = await request.get(`${FIXTURE}/api/block?header_hash=${row.header_hash}`);
      if (!detail.ok()) continue;
      const body = (await detail.json()) as { cardano?: { reconciliation?: Verdict } };
      const state = body.cardano?.reconciliation;
      if (state && !found.has(state)) found.set(state, row.header_hash);
    }
  }
  blocks = found;
  return found;
}

async function gotoBlock(page: Page, state: Verdict) {
  const hash = (await blocksByVerdict(page.request)).get(state);
  expect(hash, `the fixture produces no block in state "${state}"`).toBeTruthy();
  await page.goto(`/block/${hash}`);
}

/** A decodable transaction whose block the node reports as settled, so the
 * page reaches its tabbed layout where the compact strip lives. */
async function settledTransaction(request: APIRequestContext): Promise<string> {
  for (const p of [1, 2, 3]) {
    const list = await request.get(`${FIXTURE}/api/transactions/${p}`);
    if (!list.ok()) break;
    const { rows } = (await list.json()) as { rows: Array<{ tx_id: string }> };
    for (const row of rows) {
      const detail = await request.get(`${FIXTURE}/api/transaction?tx_hash=${row.tx_id}`);
      if (!detail.ok()) continue;
      const body = (await detail.json()) as {
        cardano?: { reconciliation?: string };
        transaction?: unknown;
      };
      if (body.cardano?.reconciliation === "node_reported" && body.transaction) return row.tx_id;
    }
  }
  throw new Error("the fixture produces no decodable settled transaction");
}

const panelOf = (page: Page) =>
  page.getByRole("heading", { name: "Cardano", exact: true }).locator("..").locator("..");

test("the fixture produces both records a single source can", async ({ page }) => {
  const found = await blocksByVerdict(page.request);
  expect([...found.keys()].sort()).toEqual(["node_reported", "none"].sort());
});

test("a settled block names the node as the source of the hash", async ({ page }) => {
  await gotoBlock(page, "node_reported");
  const panel = panelOf(page);
  await expect(panel.getByText("Settlement transaction reported by the node")).toBeVisible();
  await expect(panel.getByText(/does not check Cardano itself/)).toBeVisible();
  // The record survives: its source row and the node's own status.
  await expect(panel.getByText("Midgard node", { exact: true })).toBeVisible();
  await expect(panel.getByText(/deployment as configured/)).toBeVisible();
});

/** The panel's job is the relationship between a Midgard block and the Cardano
 * transaction the node recorded for it, and the explorer's own page for that
 * hash says what Midgard did with it. The bridge tables link their hashes
 * straight out, which is a separate and older decision. */
test("a settled block keeps its settlement link inside the explorer", async ({ page }) => {
  await gotoBlock(page, "node_reported");
  const panel = panelOf(page);
  await expect(panel.locator('a[href^="/l1/transaction/"]').first()).toBeVisible();
  await expect(panel.locator('a[href*="cexplorer.io"], a[href*="cardanoscan.io"]')).toHaveCount(0);
});

test("a settled block claims no independent confirmation anywhere on the page", async ({
  page,
}) => {
  await gotoBlock(page, "node_reported");
  const panel = panelOf(page);
  const text = ((await panel.textContent()) ?? "").toLowerCase();
  for (const claim of ["agree", "index", "confirmed", "corroborat", "verified"]) {
    expect(text, `the panel claimed "${claim}"`).not.toContain(claim);
  }
  // The headline is the strongest claim on the page, and it is not in the panel.
  await expect(page.getByText("Final on Cardano, as the node records it").first()).toBeVisible();
  // The tab that rendered the decommissioned index is gone, not left empty.
  await expect(page.getByRole("tab", { name: "Cardano evidence" })).toHaveCount(0);
});

test("a block with no node record says so without inventing evidence", async ({ page }) => {
  await gotoBlock(page, "none");
  const panel = panelOf(page);
  await expect(panel.getByText("No settlement transaction recorded")).toBeVisible();
  await expect(panel.getByText(/reported by the node/)).toHaveCount(0);
  await expect(panel.locator('a[href^="/l1/transaction/"]')).toHaveCount(0);
});

test("a settled transaction keeps its quiet placement and its evidence panel", async ({ page }) => {
  await page.goto(`/transaction/${await settledTransaction(page.request)}`);

  // The compact strip: the one label with no paragraph under it to qualify it.
  await expect(page.getByText("Settlement reported by the node")).toBeVisible();
  await expect(page.getByText("Cardano settlement", { exact: true })).toHaveCount(0);

  // The evidence panel is still reachable, and says the transaction settles
  // through its block rather than having an L1 transaction of its own.
  await page.getByRole("tab", { name: "Technical details" }).click();
  const details = page.locator("#panel-details");
  await details.getByText("Settlement evidence").click();
  await expect(details.getByText("Settled through its block")).toBeVisible();
  await expect(details.getByText(/reported by the node/).first()).toBeVisible();
});
