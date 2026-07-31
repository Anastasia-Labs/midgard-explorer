import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE,
  expectNoViolations,
  firstBlockHash,
  isNarrow,
  rowRegion,
  settle,
  txWithStatus,
} from "./helpers";

/** Populated-state coverage: the states the July 2026 design review could not
 * judge because no data was available. Every assertion here needs real rows. */

const fixtureAddress = async (page: Page, i: number): Promise<string> => {
  const rows = await page.request
    .get(`${FIXTURE}/api/deposits/1`)
    .then(async (r) => (await r.json()).rows as Array<{ ledger_address: string }>);
  const unique = [...new Set(rows.map((r) => r.ledger_address))];
  const address = unique[i];
  if (!address) throw new Error(`no fixture address at index ${i}`);
  return address;
};

test.describe("populated lists", () => {
  test("blocks list shows rows and a total", async ({ page }) => {
    await page.goto("/blocks");
    await expect(rowRegion(page)).toBeVisible();
    await expect(page.getByText(/total blocks/)).toBeVisible();
    await expect(rowRegion(page).locator("tr, li")).not.toHaveCount(0);
  });

  test("transactions list flags rows that failed to decode", async ({ page }) => {
    await page.goto("/transactions");
    await expect(rowRegion(page).getByText("Partial decode").first()).toBeVisible();
  });

  test("deposits list shows the L1 to L2 direction and a status key", async ({ page }) => {
    await page.goto("/deposits");
    await expect(page.getByText("L1", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("L2", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Status key")).toBeVisible();
  });

  test("withdrawals separate validity from lifecycle status", async ({ page }) => {
    await page.goto("/withdrawals");
    if (await isNarrow(page)) {
      // Below sm the table is replaced by ledger rows; validity moves into the
      // per-row disclosure rather than disappearing.
      await page.getByText("Details").first().click();
      await expect(page.getByText("Validity").first()).toBeVisible();
    } else {
      await expect(page.getByRole("columnheader", { name: "Validity" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    }
  });

  test("an undecodable bridge row says so instead of showing a wrong amount", async ({ page }) => {
    await page.goto("/deposits");
    await expect(rowRegion(page).getByText("undecodable").first()).toBeVisible();
  });

  test("every known bridge status renders a labelled badge", async ({ page }) => {
    await page.goto("/deposits");
    for (const label of ["Awaiting", "Projected", "Consumed"]) {
      await expect(rowRegion(page).getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("mobile rows keep identity, status and amount without horizontal scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/deposits");
    await expect(page.getByText("Details").first()).toBeVisible();
    await settle(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("block detail", () => {
  test("shows height, settlement evidence and the DA tab", async ({ page }) => {
    const hash = await firstBlockHash(page);
    await page.goto(`/block/${hash}`);
    await expect(page.getByRole("heading", { level: 1, name: /Block #/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Transactions/ })).toBeVisible();
    await expect(page.getByLabel("Block finalization timeline")).toBeVisible();
    await expect(page.getByText("Observed on L1")).toBeVisible();

    await page.getByRole("tab", { name: "Data availability" }).click();
    await expect(page).toHaveURL(/tab=da/);
    await expect(page.getByRole("tabpanel").filter({ hasText: "UTxOs root" })).toBeVisible();
    await expect(page.getByText("Block start")).toBeVisible();
  });

  test("tab selection survives a reload because it lives in the URL", async ({ page }) => {
    const hash = await firstBlockHash(page);
    await page.goto(`/block/${hash}`);
    await page.getByRole("tab", { name: "Data availability" }).click();
    await expect(page).toHaveURL(/tab=da/);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Data availability" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("arrow keys move between tabs", async ({ page }) => {
    const hash = await firstBlockHash(page);
    await page.goto(`/block/${hash}`);
    await page.getByRole("tab", { name: /Transactions/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Data availability" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("the raw tab offers the response as JSON", async ({ page }) => {
    const hash = await firstBlockHash(page);
    await page.goto(`/block/${hash}?tab=raw`);
    await expect(page.getByRole("heading", { name: "Raw response" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy JSON" })).toBeVisible();
  });
});

test.describe("transaction lifecycle", () => {
  test("a committed transaction shows the completed lifecycle and UTxO flow", async ({ page }) => {
    const hash = await txWithStatus(page, "committed");
    await page.goto(`/transaction/${hash}`);
    await expect(page.getByLabel("Transaction lifecycle")).toBeVisible();
    await expect(page.getByLabel("Node admission timeline")).toBeVisible();
    await expect(page.getByText("Validation started")).toBeVisible();
    await page.getByRole("tab", { name: /UTxO flow/ }).click();
    await expect(page.getByRole("heading", { name: /^Inputs \(/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Outputs \(/ })).toBeVisible();
  });

  test("a non-terminal transaction announces that it is being watched", async ({ page }) => {
    const hash = await txWithStatus(page, "pending_commit");
    await page.goto(`/transaction/${hash}`);
    await expect(page.getByText("Watching for status updates…")).toBeVisible();
  });

  test("a committed transaction does not poll", async ({ page }) => {
    const hash = await txWithStatus(page, "committed");
    await page.goto(`/transaction/${hash}`);
    await expect(page.getByText("Watching for status updates…")).toHaveCount(0);
  });

  test("a rejected transaction shows the reason and the failure path", async ({ page }) => {
    const hash = await txWithStatus(page, "rejected");
    await page.goto(`/transaction/${hash}`);
    await expect(page.getByText("Rejected by the node")).toBeVisible();
    await expect(page.getByText(/below minimum/)).toBeVisible();
    await expect(page.getByLabel("Node admission timeline").getByText("Rejected")).toBeVisible();
  });

  test("an undecodable transaction keeps everything that does not need the body", async ({
    page,
  }) => {
    const rows = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(
        async (r) => (await r.json()).rows as Array<{ tx_id: string; decodeError: string | null }>,
      );
    const undecodable = rows.find((r) => r.decodeError);
    test.skip(!undecodable, "no undecodable fixture on page 1");
    await page.goto(`/transaction/${undecodable!.tx_id}`);
    await expect(page.getByText("This transaction's body could not be decoded.")).toBeVisible();
    // The failure is scoped to the body: lifecycle, timings and settlement
    // state come from the node's own records and must survive it.
    await expect(page.getByText("L2 inclusion")).toBeVisible();
    await expect(page.getByText("Cardano L1 settlement")).toBeVisible();
    await expect(page.getByText("Node admission record", { exact: false })).toBeVisible();
  });

  test("a committed transaction links to its block and its L1 settlement state", async ({
    page,
  }) => {
    const rows = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows as Array<{ tx_id: string }>);
    await page.goto(`/transaction/${rows[0]!.tx_id}`);
    await expect(page.getByRole("link", { name: /^Block #\d+$/ })).toBeVisible();
    await expect(page.getByText("Cardano L1 settlement")).toBeVisible();
  });
});

test.describe("address detail", () => {
  test("warns that the balance undercounts when outputs failed to decode", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 1)}`);
    await expect(page.getByText("Balance is incomplete.")).toBeVisible();
    await expect(page.getByText(/Undercount/)).toBeVisible();
  });

  test("lists native assets held", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 1)}`);
    await expect(page.getByRole("heading", { name: "Native assets held" })).toBeVisible();
    await expect(page.getByText("Policy ID").first()).toBeVisible();
  });

  test("does not warn when every output decoded", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 0)}`);
    await expect(page.getByText("Balance is incomplete.")).toHaveCount(0);
  });
});

test.describe("accessibility on populated pages", () => {
  test("no automated violations with real data present", async ({ page }) => {
    const paths = [
      "/blocks",
      "/transactions",
      "/deposits",
      "/withdrawals",
      "/forced-transactions",
      `/block/${await firstBlockHash(page)}`,
      `/transaction/${await txWithStatus(page, "committed")}`,
      `/address/${await fixtureAddress(page, 1)}`,
    ];
    for (const path of paths) {
      await page.goto(path);
      await expectNoViolations(page, path);
    }
  });

  test("no violations in light theme with real data", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/deposits");
    await expectNoViolations(page, "/deposits (light)");
  });
});
