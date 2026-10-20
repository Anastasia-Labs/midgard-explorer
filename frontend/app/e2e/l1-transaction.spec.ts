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
  status: string | null;
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

test("lists what the node recorded, without a defensive subtitle", async ({ page }) => {
  await page.goto("/l1");
  await expect(page.getByRole("heading", { name: "Cardano activity" })).toBeVisible();
  await expect(page.getByText(/not a chain scan/)).toHaveCount(0);
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

test("activity transaction hashes open CExplorer and record copies preserve the full ID", async ({
  page,
}) => {
  const row = (await activity(page.request)).find((r) => r.kind === "settlement");
  expect(row).toBeTruthy();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          document.documentElement.dataset.copied = value;
        },
      },
    });
  });
  await page.goto(`/l1?page=${row!.page}`);
  const region = rowRegion(page);
  const external = region
    .locator(`a[href="https://preprod.cexplorer.io/tx/${row!.l1TxHash}"]`)
    .first();
  await expect(external).toBeVisible();
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("aria-label", /on CExplorer \(opens in a new tab\)$/);
  await expect(region.locator('a[href^="/l1/transaction/"]')).toHaveCount(0);

  const line = region
    .locator("tr, li", {
      has: page.locator(`a[href="https://preprod.cexplorer.io/tx/${row!.l1TxHash}"]`),
    })
    .first();
  const details = line.locator("summary");
  if (await details.isVisible()) await details.click();
  const record = line.locator(`a[href="/block/${row!.headerHash}"]`);
  await expect(record).toBeVisible();
  await record.locator("..").getByRole("button", { name: "Copy to clipboard" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-copied", row!.headerHash!);
});

/* A pill is for the record header; a status inside a record card reads as
 * coloured text and its mark, with no filled background. */
test("a record card states its status as text, not a pill", async ({ page }) => {
  const settlement = (await activity(page.request)).find(
    (row) => row.kind === "settlement" && row.status !== null,
  );
  expect(settlement, "the fixture records no settlement with a status").toBeTruthy();
  await page.goto(`/l1/transaction/${settlement!.l1TxHash}`);
  const card = page.getByRole("heading", { name: "Block settlement" }).locator("xpath=../..");
  const status = card
    .getByText(
      /^(Pending submission|Submitted \(.*\)|Awaiting stability|Waiting to merge|Merged|Merge not recorded|Finalized|Abandoned)$/,
    )
    .first();
  await expect(status).toBeVisible();
  const background = await status.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe("rgba(0, 0, 0, 0)");
});

/* Detail pages show when as well as how long ago; lists stay relative. */
test("a record card shows the exact instant beside the relative time", async ({ page }) => {
  const settlement = (await activity(page.request)).find((row) => row.kind === "settlement");
  await page.goto(`/l1/transaction/${settlement!.l1TxHash}`);
  const row = page.getByText("Recorded by the node").first().locator("xpath=..");
  // The sr-only copy always carries the instant; what matters is the visible text.
  await expect(
    row.locator("[aria-hidden]", { hasText: /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/ }),
  ).toHaveCount(1);
});

/* A lone output index is a number under its own label; "#N" beside a hash is an
 * output reference, and there is no hash beside it here. */
test("a bridge record names its output index without a bare #", async ({ page }) => {
  const withdrawal = (await activity(page.request)).find((row) => row.kind === "withdrawal");
  expect(withdrawal, "the fixture records no withdrawal").toBeTruthy();
  await page.goto(`/l1/transaction/${withdrawal!.l1TxHash}`);
  const row = page.getByText("Output index", { exact: true }).first().locator("xpath=..");
  await expect(row.getByText(/^\d+$/)).toBeVisible();
});
