import { expect, test, FIXTURE } from "./helpers";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * What a reader sees for a record nothing checked against Cardano.
 *
 * The resolver proves the verdict and the panel tests prove the wording, and
 * neither proves a browser ever shows it: the panel can be unmounted, hidden
 * behind a tab, or gated on a value that no longer arrives. The transaction
 * page gated three placements on `matched`, so this deployment shape silently
 * moved a notice, dropped the evidence panel and changed a label, and every
 * unit suite stayed green.
 *
 * The records are DISCOVERED by their verdict rather than named here, so the
 * fixture can renumber its blocks without quietly taking this file out of
 * service. Both fields are read, because `none` exists in the other shape too
 * and means something else there.
 */

type Declared = "node_reported" | "none";

const DECLARED = "no_independent_source";

let blocks: Map<Declared, string> | null = null;

async function declaredBlocks(request: APIRequestContext): Promise<Map<Declared, string>> {
  if (blocks) return blocks;
  const found = new Map<Declared, string>();
  for (const p of [1, 2]) {
    const list = await request.get(`${FIXTURE}/api/blocks/${p}`);
    if (!list.ok()) break;
    const { rows } = (await list.json()) as { rows: Array<{ header_hash: string }> };
    for (const row of rows) {
      const detail = await request.get(`${FIXTURE}/api/block?header_hash=${row.header_hash}`);
      if (!detail.ok()) continue;
      const body = (await detail.json()) as {
        cardano?: { reconciliation?: Declared; comparability?: string };
      };
      if (body.cardano?.comparability !== DECLARED) continue;
      const state = body.cardano.reconciliation;
      if (state && !found.has(state)) found.set(state, row.header_hash);
    }
  }
  blocks = found;
  return found;
}

async function gotoBlock(page: Page, state: Declared) {
  const hash = (await declaredBlocks(page.request)).get(state);
  expect(hash, `the fixture produces no block in state "${state}"`).toBeTruthy();
  await page.goto(`/block/${hash}`);
}

/** A transaction whose own block reached its verdict without a second source. */
async function declaredTransaction(request: APIRequestContext): Promise<string> {
  for (const p of [1, 2, 3]) {
    const list = await request.get(`${FIXTURE}/api/transactions/${p}`);
    if (!list.ok()) break;
    const { rows } = (await list.json()) as { rows: Array<{ tx_id: string }> };
    for (const row of rows) {
      const detail = await request.get(`${FIXTURE}/api/transaction?tx_hash=${row.tx_id}`);
      if (!detail.ok()) continue;
      const body = (await detail.json()) as {
        cardano?: { reconciliation?: string; comparability?: string };
      };
      if (
        body.cardano?.comparability === DECLARED &&
        body.cardano.reconciliation === "node_reported"
      )
        return row.tx_id;
    }
  }
  throw new Error("the fixture produces no settled transaction without a second source");
}

const panelOf = (page: Page) =>
  page.getByRole("heading", { name: "Cardano", exact: true }).locator("..").locator("..");

test("the fixture produces both records this shape needs", async ({ page }) => {
  const found = await declaredBlocks(page.request);
  expect([...found.keys()].sort()).toEqual(["node_reported", "none"].sort());
});

test("a settled block names the node as the source of the hash", async ({ page }) => {
  await gotoBlock(page, "node_reported");
  const panel = panelOf(page);
  await expect(panel.getByText("Settlement transaction reported by the node")).toBeVisible();
  await expect(panel.getByText(/does not check Cardano itself/)).toBeVisible();
  // The record survives: its source row, its hash and the node's own status.
  await expect(panel.getByText("Midgard node", { exact: true })).toBeVisible();
  await expect(panel.getByText("finalized", { exact: true })).toBeVisible();
});

test("a settled block keeps its settlement link", async ({ page }) => {
  await gotoBlock(page, "node_reported");
  const panel = panelOf(page);
  // Retained deliberately. Sending the reader out to a live explorer is a
  // separate decision, and this step did not take it.
  await expect(panel.locator('a[href^="/l1/transaction/"]').first()).toBeVisible();
  await expect(panel.locator('a[href*="cexplorer.io"], a[href*="cardanoscan.io"]')).toHaveCount(0);
});

test("a settled block claims no independent confirmation anywhere on the page", async ({
  page,
}) => {
  await gotoBlock(page, "node_reported");
  const panel = panelOf(page);
  const text = ((await panel.textContent()) ?? "").toLowerCase();
  for (const claim of ["agree", "index", "confirmed", "corroborat"]) {
    expect(text, `the panel claimed "${claim}"`).not.toContain(claim);
  }
  // The headline is the strongest claim on the page, and it is not in the panel.
  await expect(page.getByText("Final on Cardano, as the node records it").first()).toBeVisible();
  await expect(page.getByText("Node and index records agree")).toHaveCount(0);
});

test("a block with no node record says so without inventing evidence", async ({ page }) => {
  await gotoBlock(page, "none");
  const panel = panelOf(page);
  await expect(panel.getByText("No settlement transaction recorded")).toBeVisible();
  // "Reported by the node" over an empty record would describe evidence that
  // does not exist, and a settlement link would point at nothing.
  await expect(panel.getByText(/reported by the node/)).toHaveCount(0);
  await expect(panel.locator('a[href^="/l1/transaction/"]')).toHaveCount(0);
});

test("the Cardano evidence tab names whose observation it is", async ({ page }) => {
  const hash = (await declaredBlocks(page.request)).get("node_reported");
  await page.goto(`/block/${hash}?tab=l1`);
  await expect(
    page.getByText("Recorded by the explorer's Cardano index.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/does not use the index as a settlement source/)).toBeVisible();
});

test("a settled transaction keeps its quiet placement and its evidence panel", async ({ page }) => {
  await page.goto(`/transaction/${await declaredTransaction(page.request)}`);

  // The compact strip: the one label with no paragraph under it to qualify it.
  await expect(page.getByText("Settlement reported by the node")).toBeVisible();
  await expect(page.getByText("Cardano settlement", { exact: true })).toHaveCount(0);

  // The evidence panel is still reachable, rather than replaced by a pointer
  // to a notice that this shape no longer shows.
  await page.getByRole("tab", { name: "Technical details" }).click();
  const details = page.locator("#panel-details");
  await details.getByText("Settlement evidence").click();
  await expect(details.getByText("Settled through its block")).toBeVisible();
  await expect(details.getByText(/reported by the node/).first()).toBeVisible();
});
