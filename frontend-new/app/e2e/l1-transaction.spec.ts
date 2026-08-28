import { expect, test, FIXTURE, isNarrow } from "./helpers";

test("navigates from Cardano activity into its Midgard summary", async ({ page }) => {
  await page.goto("/l1");
  await expect(page.getByRole("heading", { name: "Cardano activity" })).toBeVisible();

  const first = page.locator('a[href^="/l1/transaction/"]:visible').first();
  await expect(first).toBeVisible();
  await first.click();

  await expect(page).toHaveURL(/\/l1\/transaction\/[0-9a-f]{64}$/);
  await expect(page.getByRole("heading", { name: "Cardano transaction" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Midgard activity" })).toBeVisible();
  await expect(page.getByText("Deposited funds into Midgard.")).toBeVisible();
  await expect(page.getByText("Committed a Midgard header to Cardano.")).toBeVisible();
  await expect(page.getByRole("link", { name: "View on CExplorer" })).toHaveAttribute(
    "href",
    /preprod\.cexplorer\.io\/tx\/[0-9a-f]{64}$/,
  );

  for (const generic of ["UTxOs", "Contracts", "Collateral", "Mint / burn", "Raw"]) {
    await expect(page.getByRole("tab", { name: generic })).toHaveCount(0);
  }
});

/** The datum names a destination, an owner, and the UTxO leaving. All three
 * were decoded at ingest and none of them reached the page, which is the same
 * defect as an unindexed field from a reader's side. */
test("shows what a user event's datum proved", async ({ page }) => {
  const specimens = await page.request.get(`${FIXTURE}/__l1-specimens`).then((r) => r.json());

  await page.goto(`/l1/transaction/${specimens.decodedDeposit}`);
  await expect(page.getByText("Midgard payment credential")).toBeVisible();
  await expect(page.getByText("Inclusion time").first()).toBeVisible();

  await page.goto(`/l1/transaction/${specimens.decodedWithdrawal}`);
  await expect(page.getByText("Owner", { exact: true })).toBeVisible();
  await expect(page.getByText("Midgard UTxO")).toBeVisible();
});

/** A deposit whose script failed used to read exactly like one that succeeded:
 * the row reported success for every classified action, with nothing having
 * checked. */
test("says when a Midgard contract failed to validate", async ({ page }) => {
  const specimens = await page.request.get(`${FIXTURE}/__l1-specimens`).then((r) => r.json());
  await page.goto(`/l1/transaction/${specimens.failedContract}`);
  await expect(page.getByText("Script validation failed")).toBeVisible();

  // And says nothing where nothing ran: an absent verdict is not a pass.
  await page.goto(`/l1/transaction/${specimens.decodedWithdrawal}`);
  await expect(page.getByText("Script validation failed")).toHaveCount(0);
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
  await expect(page.getByRole("link", { name: "View on CExplorer" })).toHaveAttribute(
    "href",
    `https://preprod.cexplorer.io/tx/${"f".repeat(64)}`,
  );
});

test("sends bridge Cardano references directly to CExplorer", async ({ page }) => {
  await page.goto("/deposits");
  // Below `sm` the ledger row carries the L1 hash behind its Details
  // disclosure rather than in a column, so the link exists but is not yet
  // rendered. Opening it asserts the same rule on the layout a phone gets.
  if (await isNarrow(page)) {
    await page.getByText("Details", { exact: true }).first().click();
  }
  const record = page.locator('a[href*="cexplorer.io/tx/"]:visible').first();
  await expect(record).toBeVisible();
  await expect(record).toHaveAttribute("target", "_blank");
});

test("opens a manifest validator's indexed UTxOs, history, and operations", async ({ page }) => {
  const summary = await page.request
    .get(`${FIXTURE}/api/l1/summary`)
    .then(
      async (response) =>
        (await response.json()) as { source: { validators: Array<{ scriptHash: string }> } },
    );
  await page.goto(`/l1/validator/${summary.source.validators[0]!.scriptHash}`);
  await expect(page).toHaveURL(/\/l1\/validator\/[0-9a-f]{56}$/);
  await expect(page.getByRole("heading", { name: /Deposit validator/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /UTxOs/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /History/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Operations/ })).toBeVisible();
});

/** The indexer has written redeemers since it first ran and no page read them,
 * so a reader could see that a Midgard contract executed but not what it cost.
 * The share is the part that needs a denominator, and the denominator is
 * Cardano's limit for this transaction's own epoch. */
test("states what a script execution cost and what share of the limit that was", async ({
  page,
}) => {
  const specimens = await page.request.get(`${FIXTURE}/__l1-specimens`).then((r) => r.json());
  await page.goto(`/l1/transaction/${specimens.decodedDeposit}`);

  await expect(page.getByRole("heading", { name: "Script executions" })).toBeVisible();
  await expect(page.getByText(/share of the per-transaction limit/)).toBeVisible();
  await expect(page.getByText("18.3%")).toBeVisible();
  await expect(page.getByText("9.0%")).toBeVisible();
});

/** The indexer has stored every UTxO of every Midgard-related transaction
 * since it was written, and none of it reached this page. An address arrived
 * with a copy button and nothing beside it: its payment credential, its stake
 * address, the UTxO it sits in and the transaction that spent it were all held
 * in the index and none were shown. */
test("shows the Cardano UTxOs with credentials, references and spenders", async ({ page }) => {
  const specimens = await page.request.get(`${FIXTURE}/__l1-specimens`).then((r) => r.json());
  await page.goto(`/l1/transaction/${specimens.spentOutput}`);

  await expect(page.getByRole("heading", { name: /^Inputs \(\d+\)/ })).toBeVisible();
  const outputs = page.getByRole("heading", { name: /^Outputs \(\d+\)/ });
  await expect(outputs).toBeVisible();

  // The address is a link out, not text with a copy button beside it.
  const address = page.getByRole("link", { name: /View this address on CExplorer/ }).first();
  await expect(address).toHaveAttribute("href", /preprod\.cexplorer\.io\/address\/addr_test1/);

  // Each UTxO names itself, and an input names the transaction that made it.
  await expect(page.locator('a[href^="/l1/transaction/"]').first()).toBeVisible();

  // The spender, where this index holds it, and the limit of that answer.
  const consumed = page.getByText("Consumed by");
  await expect(consumed).toHaveCount(1);
  await expect(page.getByText(/no spender here does not mean unspent/i)).toBeVisible();

  // Credentials open on demand, the way the Midgard transaction page shows them.
  await page.getByText("Credentials").first().click();
  await expect(page.getByText("Payment credential").first()).toBeVisible();
  await expect(page.getByText("Stake address").first()).toBeVisible();
});
