import { expect, test, FIXTURE, rowRegion } from "./helpers";

/**
 * The Cardano pages, built from what the Midgard node recorded.
 *
 * These pages used to render the explorer's own Cardano index: every
 * transaction touching a validator, its inputs, outputs, scripts and datums.
 * The index is decommissioned. What remains is the question this explorer can
 * still answer, which is what Midgard did with a Cardano transaction, and a
 * link out for everything about the transaction itself.
 */

type ActivityRow = {
  kind: "settlement" | "deposit" | "withdrawal" | "forced_transaction";
  l1TxHash: string;
  headerHash: string | null;
  recordId: string | null;
};

/** Every row, with the page each one is on. The list is newest first and the
 * fixture's settlements are its newest records, so a kind can start several
 * pages in; a test that only read page 1 would conclude the kind was missing. */
const activity = async (
  request: import("@playwright/test").APIRequestContext,
): Promise<Array<ActivityRow & { page: number }>> => {
  const rows: Array<ActivityRow & { page: number }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const body = await request.get(`${FIXTURE}/api/l1/activity/${page}`).then((r) => r.json());
    rows.push(...(body.rows as ActivityRow[]).map((row) => ({ ...row, page })));
    if (!body.hasNextPage) break;
  }
  return rows;
};

test("lists what the node recorded, and says it is not a chain scan", async ({ page }) => {
  await page.goto("/l1");
  await expect(page.getByRole("heading", { name: "Cardano activity" })).toBeVisible();
  await expect(page.getByText(/The node's records, not a chain scan\./)).toBeVisible();
  // The rows, not a table cell: below `sm` the table is replaced by a list, so
  // a cell-role assertion passes on desktop and finds nothing on a phone.
  await expect(rowRegion(page).getByText("Block settlement").first()).toBeVisible();
});

/** Every kind the node records reaches the one list, each on the page the
 * ordering puts it. A union that dropped a kind would look like a deployment
 * that had none of it. */
test("brings every kind of record into the one list", async ({ page }) => {
  const rows = await activity(page.request);
  const labels = {
    settlement: "Block settlement",
    deposit: "Deposit",
    withdrawal: "Withdrawal",
    forced_transaction: "Forced transaction",
  } as const;
  for (const [kind, label] of Object.entries(labels)) {
    const first = rows.find((row) => row.kind === kind);
    expect(first, `the list holds no ${kind}`).toBeTruthy();
    await page.goto(`/l1?page=${first!.page}`);
    await expect(rowRegion(page).getByText(label).first()).toBeVisible();
  }
});

test("opens a transaction on the Midgard context the node holds for it", async ({ page }) => {
  const settlement = (await activity(page.request)).find((row) => row.kind === "settlement");
  expect(settlement, "the fixture records no settlement").toBeTruthy();
  await page.goto(`/l1/transaction/${settlement!.l1TxHash}`);

  await expect(page.getByRole("heading", { name: "Cardano transaction" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Block settlement" })).toBeVisible();
  // The Midgard record it belongs to, one click away.
  await expect(page.locator(`a[href="/block/${settlement!.headerHash}"]`).first()).toBeVisible();
  // And the transaction itself, on the configured Cardano explorer.
  await expect(page.getByRole("link", { name: "View on CExplorer" })).toHaveAttribute(
    "href",
    /preprod\.cexplorer\.io\/tx\/[0-9a-f]{64}$/,
  );
  await expect(page.getByText(/Its inputs, outputs and scripts are on Cardano/)).toBeVisible();
  // No decoded transaction body: that came from the decommissioned index.
  for (const section of ["UTxOs", "Contracts", "Collateral", "Raw"]) {
    await expect(page.getByRole("tab", { name: section })).toHaveCount(0);
  }
});

test("a bridge record links back to its own list, filtered to it", async ({ page }) => {
  const deposit = (await activity(page.request)).find((row) => row.kind === "deposit");
  expect(deposit, "the fixture records no deposit").toBeTruthy();
  await page.goto(`/l1/transaction/${deposit!.l1TxHash}`);
  await expect(page.getByRole("heading", { name: "Deposit" })).toBeVisible();
  await expect(page.locator(`a[href="/deposits?id=${deposit!.recordId}"]`).first()).toBeVisible();
});

/** A hash no Midgard record names is a fact about Midgard's records, and the
 * page must not turn it into a claim about Cardano. */
test("a hash no Midgard record names is not called missing from Cardano", async ({ page }) => {
  await page.goto(`/l1/transaction/${"e".repeat(64)}`);
  await expect(page.getByText("Midgard has no record of this transaction")).toBeVisible();
  await expect(page.getByText(/not about Cardano/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View on CExplorer" })).toBeVisible();
});

test("a validator page describes the manifest and links its address out", async ({ page }) => {
  const validators = (await page.request.get(`${FIXTURE}/api/l1/validators`).then((r) => r.json()))
    .validators as Array<{ scriptHash: string; address: string }>;
  const first = validators[0]!;
  await page.goto(`/l1/validator/${first.scriptHash}`);
  await expect(page.getByText("Declared by the manifest")).toBeVisible();
  // Operator setup instructions are not reader copy.
  await expect(page.getByText(/Configure/)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: new RegExp(`View ${first.address} on CExplorer`) }),
  ).toHaveAttribute("href", /preprod\.cexplorer\.io\/address\//);
  // Configuration, never evidence: nothing says verified.
  await expect(page.getByText(/verified/i)).toHaveCount(0);
});

test("a script hash the manifest does not declare is not found", async ({ page }) => {
  const response = await page.goto(`/l1/validator/${"0".repeat(56)}`);
  expect(response?.status()).toBe(404);
});

/** The old commitments list answered a question `/blocks` answers from the
 * node's own records, so its address redirects there rather than going dead. */
test("the retired commitments page redirects to the blocks list", async ({ page }) => {
  const response = await page.goto("/l1/commitments");
  await expect(page).toHaveURL(/\/blocks$/);
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Blocks" }).first()).toBeVisible();
});
