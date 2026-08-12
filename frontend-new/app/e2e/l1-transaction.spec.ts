import { expect, test, FIXTURE, isNarrow } from "./helpers";

test("navigates from Cardano activity into a complete L1 investigation", async ({ page }) => {
  await page.goto("/l1");
  await expect(page.getByRole("heading", { name: "Cardano L1 activity" })).toBeVisible();

  const first = page.locator('a[href^="/l1/transaction/"]:visible').first();
  await expect(first).toBeVisible();
  await first.click();

  await expect(page).toHaveURL(/\/l1\/transaction\/[0-9a-f]{64}$/);
  await expect(page.getByRole("heading", { name: "Cardano L1 transaction" })).toBeVisible();
  await expect(page.getByText("Ledger details")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open transaction on Cardanoscan" }),
  ).toHaveAttribute("href", /preprod\.cardanoscan\.io\/transaction\/[0-9a-f]{64}$/);

  await page.getByRole("tab", { name: /UTxOs/ }).click();
  await expect(page.getByText("Reference inputs")).toBeVisible();
  await expect(page.getByText("Payment credential").first()).toBeVisible();
  await expect(page.getByText("Inline datum").first()).toBeVisible();
  await expect(
    page.getByText("Deposit", { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("manifest").filter({ visible: true }).first()).toBeVisible();

  await page.getByRole("tab", { name: /Contracts/ }).click();
  await expect(page.getByText("Memory units")).toBeVisible();
  await expect(page.getByText("Validated")).toBeVisible();

  await page.getByRole("tab", { name: /Collateral/ }).click();
  await expect(page.getByText("Collateral inputs")).toBeVisible();
  await expect(page.getByText("Collateral return")).toBeVisible();

  await page.getByRole("tab", { name: /Mint \/ burn/ }).click();
  await expect(page.getByText("Mint", { exact: true })).toBeVisible();
  await expect(page.getByText("Burn", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /Events/ }).click();
  await expect(page.getByText("Decoded event").first()).toBeVisible();

  await page.getByRole("tab", { name: "Raw" }).click();
  await expect(page.getByRole("region", { name: "Raw response body" })).toContainText(
    '"referenceInputs"',
  );
});

test("rejects an identifier that is not a transaction hash", async ({ page }) => {
  await page.goto("/l1/transaction/not-a-hash");
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
});

/* A well-formed hash we hold nothing about is a different answer from a
 * malformed one. It is usually a real Cardano transaction, so the page says
 * which case it is and delegates, rather than making the reader discover the
 * internal/external distinction by hitting a dead end. */
test("delegates a hash it holds no Midgard record for", async ({ page }) => {
  await page.goto(`/l1/transaction/${"f".repeat(64)}`);

  await expect(
    page.getByRole("heading", { name: "No Midgard record for this transaction" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /not found/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View on Cardanoscan" })).toHaveAttribute(
    "href",
    `https://preprod.cardanoscan.io/transaction/${"f".repeat(64)}`,
  );
});

/* The polarity rule, asserted where a reader meets it. A consumed input's
 * provenance is ordinary Cardano history and leaves; the Midgard records that
 * deposits, withdrawals and forced transactions point at stay here. */
test("sends input provenance out and Midgard records in", async ({ page }) => {
  const rows = await page.request
    .get(`${FIXTURE}/api/l1/transactions/1`)
    .then(async (r) => (await r.json()).rows as Array<{ txHash: string }>);
  await page.goto(`/l1/transaction/${rows[0]!.txHash}?tab=utxos`);

  const provenance = page.locator('a[href*="cardanoscan.io"]:visible').first();
  await expect(provenance).toBeVisible();
  await expect(provenance).toHaveAttribute("target", "_blank");

  await page.goto("/deposits");
  // Below `sm` the ledger row carries the L1 hash behind its Details
  // disclosure rather than in a column, so the link exists but is not yet
  // rendered. Opening it asserts the same rule on the layout a phone gets.
  if (await isNarrow(page)) {
    await page.getByText("Details", { exact: true }).first().click();
  }
  const record = page.locator('a[href^="/l1/transaction/"]:visible').first();
  await expect(record).toBeVisible();
  await expect(record).not.toHaveAttribute("target", "_blank");
});
