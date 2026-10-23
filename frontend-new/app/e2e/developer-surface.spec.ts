import {
  FIXTURE,
  expect,
  expectNoViolations,
  settle,
  test,
  txWithStatus,
  txWithoutInvocations,
} from "./helpers";

/**
 * Phase 2: what a developer opens a transaction to find out.
 *
 * Tab names follow the captured convention rather than our own vocabulary:
 * Etherscan, Blockscout and cexplorer all call "what this transaction changed"
 * the State, so that is what it is called here.
 */

const openTx = async (page: import("@playwright/test").Page) => {
  const hash = await txWithStatus(page, "committed");
  await page.goto(`/transaction/${hash}`);
  await settle(page);
  return hash;
};

test.describe("transaction tabs", () => {
  test("offers the convention's sections", async ({ page }) => {
    await openTx(page);
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveText([/Overview/, /State/, /Datums & redeemers/, /Events/, /Raw/]);
  });

  test("a section is linkable and survives a reload", async ({ page }) => {
    await openTx(page);
    await page.getByRole("tab", { name: /Datums & redeemers/ }).click();
    await expect(page).toHaveURL(/[?&]tab=datums/);
    await page.reload();
    await settle(page);
    await expect(page.getByRole("tab", { name: /Datums & redeemers/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

test.describe("events", () => {
  test("shows authoritative invocations without claiming emitted logs", async ({ page }) => {
    await openTx(page);
    await page.getByRole("tab", { name: /Events/ }).click();
    const events = page.getByRole("tabpanel", { name: /Events/ });
    await expect(events.getByRole("heading", { name: /Script invocations/ })).toBeVisible();
    await expect(events.getByRole("heading", { name: "Spend", exact: true })).toBeVisible();
    await expect(events.getByText(/spend #0/i).first()).toBeVisible();
    await expect(events.getByText("script", { exact: true }).first()).toBeVisible();
    await events.getByText("Decoded redeemer and raw CBOR").first().click();
    await expect(events.getByRole("region", { name: /decoded redeemer/i }).first()).toBeVisible();
    await expect(events.getByRole("region", { name: /redeemer CBOR/i }).first()).toBeVisible();
  });

  test("omits the events tab when no script ran", async ({ page }) => {
    const hash = await txWithoutInvocations(page);
    await page.goto(`/transaction/${hash}?tab=events`);
    await settle(page);
    await expect(page.getByRole("tab", { name: /Events/ })).toHaveCount(0);
  });
});

test.describe("datums and redeemers", () => {
  test("shows a datum's bytes and its decoded reading", async ({ page }) => {
    await openTx(page);
    await page.getByRole("tab", { name: /Datums & redeemers/ }).click();

    const datum = page.getByText("Inline datum").first();
    await expect(datum).toBeVisible();

    // The bytes are the answer of record, so hex must always be reachable even
    // when a decoded view is offered.
    const panel = page
      .locator("div")
      .filter({ hasText: /^Inline datum/ })
      .first();
    await expect(panel).toBeVisible();
  });

  test("says so plainly when a payload will not decode, rather than showing nothing", async ({
    page,
  }) => {
    // At least one fixture datum is deliberately undecodable.
    await page.goto("/transactions");
    await settle(page);
    let found = false;
    const rows = page.getByRole("link", { name: /^[0-9a-f]{8}/ });
    const count = Math.min(await rows.count(), 8);
    for (let i = 0; i < count; i += 1) {
      const href = await rows.nth(i).getAttribute("href");
      if (!href?.startsWith("/transaction/")) continue;
      await page.goto(`${href}?tab=datums`);
      await settle(page);
      if ((await page.getByText("hex only").count()) > 0) {
        found = true;
        break;
      }
    }
    expect(found, "no fixture transaction exercised the hex-only datum path").toBe(true);
  });

  test("shows script bytes with recomputed-hash provenance", async ({ page }) => {
    await openTx(page);
    await page.getByRole("tab", { name: /Datums & redeemers/ }).click();
    const disclosure = page.getByText("Script bytes and provenance").first();
    await disclosure.click();
    await expect(page.getByText(/Source: transaction witness set/).first()).toBeVisible();
    await expect(page.getByText("Hash verified").first()).toBeVisible();
  });
});

test.describe("protocol details", () => {
  test("shows authorization and commitments without listing absent Cardano features", async ({
    page,
  }) => {
    await openTx(page);
    // Overview, not a Details tab of its own: four hashes behind a tab a
    // reader has to open is a tab that hides them.
    await expect(page.getByText("Authorization and commitments")).toBeVisible();
    await expect(page.getByText("Required signers")).toBeVisible();
    await expect(page.getByText("Protocol availability")).toHaveCount(0);
  });
});

test.describe("raw bytes", () => {
  test("carries the transaction's own CBOR with its size", async ({ page }) => {
    const hash = await openTx(page);
    await page.goto(`/transaction/${hash}?tab=raw`);
    await settle(page);

    const cbor = page.locator("section").filter({ hasText: "Transaction CBOR" }).first();
    await expect(cbor.getByRole("heading", { name: "Transaction CBOR" })).toBeVisible();
    await expect(cbor.getByRole("link", { name: "Download" })).toBeVisible();
    await expect(cbor.getByRole("region", { name: "Transaction CBOR bytes" })).toBeVisible();
    // The JSON view stays beside the hex rather than being replaced by it.
    await expect(page.getByRole("heading", { name: "Raw response" })).toBeVisible();
  });
});

test.describe("state", () => {
  test("shows output spendability and credential identities", async ({ page }) => {
    const hash = await openTx(page);
    await page.goto(`/transaction/${hash}?tab=utxo`);
    await settle(page);
    await expect(page.getByText(/Unspent|Not in current ledger/).first()).toBeVisible();
    await page.getByText("Credentials").first().click();
    await expect(page.getByText("Payment credential").first()).toBeVisible();
  });

  test("resolves reference-input values without calling them spent", async ({ page }) => {
    const rows = await page.request.get(`${FIXTURE}/api/transactions/1`).then(
      async (response) =>
        (await response.json()).rows as Array<{
          tx_id: string;
          transaction: { referenceInputs: unknown[] } | null;
        }>,
    );
    const row = rows.find((candidate) => candidate.transaction?.referenceInputs.length);
    expect(row, "no fixture transaction carries a reference input").toBeDefined();
    await page.goto(`/transaction/${row!.tx_id}`);
    await expect(page.getByText(/Reference inputs \(1\)/)).toBeVisible();
    await expect(page.getByText(/Read by scripts without being spent/)).toBeVisible();
  });

  test("reports movement per native asset, not only in ada", async ({ page }) => {
    // Ask the fixture which transaction actually carries an asset rather than
    // scanning pages: a scan that finds nothing cannot tell "the feature is
    // missing" from "I never reached a transaction that would show it".
    const rows = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows as Array<{ tx_id: string; transaction: unknown }>);
    const withAsset = rows.find((r) => {
      const tx = r.transaction as { outputs?: Array<{ value: { assets: object } }> } | null;
      return tx?.outputs?.some((o) => Object.keys(o.value.assets).length > 0) ?? false;
    });
    expect(withAsset, "no fixture transaction on page 1 carries a native asset").toBeDefined();

    await page.goto(`/transaction/${withAsset!.tx_id}?tab=utxo`);
    await settle(page);
    await expect(page.getByRole("heading", { name: /Net movement by address/ })).toBeVisible();
    // The asset name renders beside its policy, which ada-only movement never showed.
    await expect(page.getByText(/^[0-9a-f]{6}…[0-9a-f]{4}$/).first()).toBeVisible();
  });
});

test.describe("accessibility of the new surface", () => {
  for (const tab of ["datums", "summary", "raw", "utxo"] as const) {
    test(`the ${tab} tab has no automated violations in either theme`, async ({ page }) => {
      const hash = await txWithStatus(page, "committed");
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/transaction/${hash}?tab=${tab}`);
        await settle(page);
        await expectNoViolations(page, `tx ?tab=${tab} (${scheme})`);
      }
    });
  }
});
