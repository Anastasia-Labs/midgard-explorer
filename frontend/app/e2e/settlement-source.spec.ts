import { APPLIED_LABEL, APPLIED_STATUSES, FIXTURE, expect, test } from "./helpers";
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
  // The same shape as a settled transaction: the hash in the header, and the
  // block's state and the source in the Details tab.
  const identity = page.locator('[data-region="identity"]');
  await expect(identity.getByText("Settlement", { exact: true })).toBeVisible();
  await expect(identity.getByText(APPLIED_LABEL).first()).toBeVisible();
  await page.getByRole("tab", { name: "Details" }).click();
  const details = page.locator("#panel-details");
  // The state is where the block stands, read from the follower's tables
  // for an applied block, so it is never attributed to the journal.
  await expect(details.getByText(APPLIED_LABEL).first()).toBeVisible();
  await expect(details.getByText(/reported by/)).toHaveCount(0);
  await expect(details.getByText(/deployment as configured/)).toBeVisible();
});

/** A block's settlement transaction opens on the Cardano explorer, like every
 * other Cardano hash; the internal page is reached from search. (Decided
 * 2026-09-29, reversing the earlier inside-the-explorer rule.) */
test("a settled block links its settlement to CExplorer", async ({ page }) => {
  await gotoBlock(page, "node_reported");
  const identity = page.locator('[data-region="identity"]');
  await expect(identity.locator('a[href^="https://preprod.cexplorer.io/tx/"]')).toBeVisible();
  await expect(identity.locator('a[href^="/l1/transaction/"]')).toHaveCount(0);
  await page.getByRole("tab", { name: "Details" }).click();
  const details = page.locator("#panel-details");
  await expect(details.locator('a[href^="https://preprod.cexplorer.io/tx/"]')).toHaveCount(1);
  await expect(details.locator('a[href^="/l1/transaction/"]')).toHaveCount(0);
});

test("a settled block claims no independent confirmation anywhere on the page", async ({
  page,
}) => {
  await gotoBlock(page, "node_reported");
  await page.getByRole("tab", { name: "Details" }).click();
  const details = page.locator("#panel-details");
  const text = ((await details.textContent()) ?? "").toLowerCase();
  for (const claim of ["agree", "index", "confirmed", "corroborat", "verified"]) {
    expect(text, `the settlement details claimed "${claim}"`).not.toContain(claim);
  }
  await expect(page.getByText(APPLIED_LABEL).first()).toBeVisible();
  // The tab that rendered the decommissioned index is gone, not left empty.
  await expect(page.getByRole("tab", { name: "Cardano evidence" })).toHaveCount(0);
});

test("a block with no node record says so without inventing evidence", async ({ page }) => {
  await gotoBlock(page, "none");
  const panel = panelOf(page);
  await expect(panel.getByText("No settlement transaction recorded")).toBeVisible();
  await expect(panel.getByText(/reported by the node/)).toHaveCount(0);
  await expect(panel.locator('a[href^="https://preprod.cexplorer.io/tx/"]')).toHaveCount(0);
});

test("a settled transaction carries its settlement hash in the header and its evidence below", async ({
  page,
}) => {
  await page.goto(`/transaction/${await settledTransaction(page.request)}`);

  // The hash sits in the header beside the block, under the badge it supports.
  const identity = page.locator('[data-region="identity"]');
  await expect(identity.getByText("Settlement", { exact: true })).toBeVisible();
  await expect(identity.locator('a[href^="https://preprod.cexplorer.io/tx/"]')).toBeVisible();
  await expect(identity.getByText(APPLIED_LABEL).first()).toBeVisible();

  // The Details tab lists the settlement once: the Cardano transaction, where
  // the block stands, and every stage in order.
  await page.getByRole("tab", { name: "Details" }).click();
  const details = page.locator("#panel-details");
  await expect(details.getByText("Settlement", { exact: true })).toBeVisible();
  // The state is where the block stands, read from the follower's tables
  // for an applied block, so it is never attributed to the journal.
  await expect(details.getByText(APPLIED_LABEL).first()).toBeVisible();
  await expect(details.getByText(/reported by/)).toHaveCount(0);
  await expect(details.locator('a[href^="https://preprod.cexplorer.io/tx/"]')).toHaveCount(1);
});

test("a settled transaction's Settlement figure opens CExplorer in a new tab", async ({ page }) => {
  const list = await page.request.get(`${FIXTURE}/api/transactions/1`).then((r) => r.json());
  const tx = (list.rows as Array<{ tx_id: string; finalization_status: string | null }>).find((r) =>
    APPLIED_STATUSES.includes(r.finalization_status ?? ""),
  );
  expect(tx).toBeTruthy();
  await page.goto(`/transaction/${tx!.tx_id}`);
  const link = page.locator('[data-region="identity"]').getByRole("link", { name: /on CExplorer/ });
  await expect(link).toHaveAttribute(
    "href",
    /^https:\/\/preprod\.cexplorer\.io\/tx\/[0-9a-f]{64}$/,
  );
  await expect(link).toHaveAttribute("target", "_blank");
});
