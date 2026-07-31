import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE,
  expectNoViolations,
  firstBlockHash,
  isNarrow,
  rowRegion,
  settle,
  txAwaitingFinality,
  txInAbandonedBlock,
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

test.describe("operational metrics", () => {
  test("answers whether the chain is healthy before anything else", async ({ page }) => {
    await page.goto("/");
    const metrics = page.locator('[data-region="metrics"]');
    await expect(metrics).toBeVisible();
    await expect(metrics.getByText("Chain tip")).toBeVisible();
    await expect(metrics.getByText("Admission", { exact: true })).toBeVisible();
    await expect(metrics.getByText("L1 settlement")).toBeVisible();
  });

  test("labels a percentile drawn from too few records", async ({ page }) => {
    await page.goto("/");
    // The fixture settles only a handful of blocks, which is exactly the case
    // where a p95 must not be presented as a measurement.
    await expect(page.getByText(/thin sample/)).toBeVisible();
  });

  test("says when the window covers less history than its label", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/the node holds history only from/)).toBeVisible();
  });

  test("marks an hour that produced no blocks instead of smoothing over it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/with no blocks/)).toBeVisible();
  });

  test("names the node column behind every figure", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Status breakdown and where each figure comes from").click();
    await expect(page.getByText("tx_admissions.terminal_at - tx_admissions.first_seen_at")).toBeVisible();
    await expect(page.getByText("blocks.height, blocks.time_stamp_tz")).toBeVisible();
  });

  test("links the oldest block still waiting on L1", async ({ page }) => {
    await page.goto("/");
    const oldest = page.getByText("Oldest block awaiting L1").locator("..");
    await expect(oldest.getByRole("link")).toBeVisible();
    await oldest.getByRole("link").click();
    await expect(page).toHaveURL(/\/block\/[0-9a-f]{56}/);
  });

  test("the panel survives a metrics failure without blanking the page", async ({ page }) => {
    await page.request.post(`${FIXTURE}/__control?fail=metrics`);
    try {
      await page.goto("/");
      await expect(page.getByText("Metrics are unavailable.")).toBeVisible();
      // The rest of the overview still has to work.
      await expect(page.getByText("Latest blocks")).toBeVisible();
    } finally {
      await page.request.post(`${FIXTURE}/__control`);
    }
  });
});

test.describe("native assets", () => {
  const roster = async (page: Page) =>
    page.request.get(`${FIXTURE}/api/assets`).then(async (r) => {
      const body = await r.json();
      return body.rows as Array<{ policyId: string; assetName: string }>;
    });

  test("the roster lists every asset on the ledger with its fingerprint", async ({ page }) => {
    await page.goto("/assets");
    await expect(page.getByRole("heading", { level: 1, name: "Native assets" })).toBeVisible();
    // The fingerprint is the identifier worth comparing; a display name is not
    // unique and a policy ID is 56 characters of noise.
    await expect(rowRegion(page).getByText(/^asset1/).first()).toBeVisible();
  });

  test("a readable name is shown as text, with its bytes alongside", async ({ page }) => {
    await page.goto("/assets");
    await expect(rowRegion(page).getByText("MIDGARD").first()).toBeVisible();
    await expect(rowRegion(page).getByText("PATATE").first()).toBeVisible();
  });

  test("bytes that are not text stay hex rather than becoming a guess", async ({ page }) => {
    await page.goto("/assets");
    await expect(rowRegion(page).getByText("fffe0102").first()).toBeVisible();
  });

  test("a name carrying a bidi override is never rendered as text", async ({ page }) => {
    // "USD" + U+202E + "C" renders as "USDC" reversed, which is how one token
    // is made to read as another. It must appear as its bytes.
    await page.goto("/assets");
    await expect(rowRegion(page).getByText("555344e280ae43").first()).toBeVisible();
    await expect(page.getByText("USD‮C")).toHaveCount(0);
  });

  test("an asset page names the asset, its policy and its holders", async ({ page }) => {
    const rows = await roster(page);
    const row = rows.find((r) => r.assetName === "504154415445");
    test.skip(!row, "no PATATE asset in the fixture roster");
    await page.goto(`/asset/${row!.policyId}${row!.assetName}`);
    await expect(page.getByRole("heading", { level: 1, name: "PATATE" })).toBeVisible();
    await expect(page.getByText("Fingerprint (CIP-14)")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Holders/ })).toBeVisible();
    await expect(page.getByText(/^asset1/).first()).toBeVisible();
  });

  test("the asset page says its total describes the ledger now, not history", async ({ page }) => {
    const rows = await roster(page);
    await page.goto(`/asset/${rows[0]!.policyId}${rows[0]!.assetName}`);
    await expect(page.getByText(/describes the ledger now rather than its history/)).toBeVisible();
  });

  test("a quantity past the safe integer range is not rounded", async ({ page }) => {
    const rows = await roster(page);
    const row = rows.find((r) => r.assetName === "fffe0102");
    test.skip(!row, "no large-supply asset in the fixture roster");
    await page.goto(`/asset/${row!.policyId}${row!.assetName}`);
    // Number("18446744073709551615") is 18446744073709552000.
    await expect(page.getByText("18,446,744,073,709,551,615").first()).toBeVisible();
  });

  test("a malformed asset unit renders the not-found page", async ({ page }) => {
    await page.goto("/asset/nothex");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  // Same open defect as /block and /transaction: notFound() inside a dynamic
  // route renders the not-found page but answers HTTP 200.
  test.fixme("a malformed asset unit responds with HTTP 404", async ({ page }) => {
    const res = await page.goto("/asset/nothex");
    expect(res?.status()).toBe(404);
  });

  test("each holder links to its address page", async ({ page }) => {
    const rows = await roster(page);
    await page.goto(`/asset/${rows[0]!.policyId}${rows[0]!.assetName}`);
    const link = rowRegion(page).getByRole("link").first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /^\/address\/addr_test/);
  });
});

test.describe("block detail", () => {
  test("shows height, settlement evidence and the DA tab", async ({ page }) => {
    const hash = await firstBlockHash(page);
    await page.goto(`/block/${hash}`);
    await expect(page.getByRole("heading", { level: 1, name: /Block #/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Transactions/ })).toBeVisible();
    // The block's settlement story uses the same journey grammar as a
    // transaction's, with the intermediate L1 stages promoted to the rail
    // because settlement is the whole of a block's story.
    const journey = page.getByRole("region", { name: "Protocol journey" });
    await expect(journey).toBeVisible();
    await expect(journey.getByRole("list").getByText("Seen on L1")).toBeVisible();
    await journey.getByText("Settlement timings and evidence").click();
    await expect(journey.getByRole("group").getByText("Queued for L1")).toBeVisible();

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
    const hash = await txAwaitingFinality(page);
    await page.goto(`/transaction/${hash}`);
    // One journey replaces the lifecycle chips, admission timeline and
    // settlement band; per-stage timings live behind its disclosure.
    const journey = page.getByRole("region", { name: "Protocol journey" });
    await expect(journey).toBeVisible();
    await expect(journey.getByText("Committed, awaiting L1 finality")).toBeVisible();
    await journey.getByText("Stage timings and evidence").click();
    // The label appears on the rail and again in the details grid; the details
    // entry is the one that carries the recorded timestamp.
    await expect(journey.getByRole("group").getByText("Validated")).toBeVisible();
    await page.getByRole("tab", { name: /UTxO flow/ }).click();
    await expect(page.getByRole("heading", { name: /^Inputs \(/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Outputs \(/ })).toBeVisible();
  });

  test("the UTxO tab states the ledger equation rather than only listing sides", async ({
    page,
  }) => {
    // The fixture resolves every input on every fourth transaction, which is
    // the only case where the equation can be checked.
    const rows = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows as Array<{ tx_id: string }>);
    let complete: string | null = null;
    let partial: string | null = null;
    for (const row of rows) {
      const body = await page.request
        .get(`${FIXTURE}/api/transaction?tx_hash=${row.tx_id}`)
        .then((r) => r.json());
      const inputs = body.transaction?.inputs;
      if (!inputs) continue;
      const resolvedAll = inputs.every((i: { resolved: unknown }) => i.resolved !== null);
      if (resolvedAll && complete === null) complete = row.tx_id;
      if (!resolvedAll && partial === null) partial = row.tx_id;
      if (complete && partial) break;
    }

    test.skip(complete === null || partial === null, "fixture lacks both input-resolution states");

    await page.goto(`/transaction/${complete}?tab=utxo`);
    const ledger = page.locator('[data-region="ledger"]');
    await expect(ledger).toBeVisible();
    await expect(ledger.getByText(/everything spent is accounted for/)).toBeVisible();
    await expect(ledger.getByText("Net movement by address")).toBeVisible();

    // With an unresolved input the total is a lower bound and must say so
    // rather than presenting the surviving inputs as a sum.
    await page.goto(`/transaction/${partial}?tab=utxo`);
    await expect(ledger.getByText("At least")).toBeVisible();
    await expect(ledger.getByText(/the equation cannot be checked here/)).toBeVisible();
    await expect(ledger.getByText(/spend side unknown/).first()).toBeVisible();
  });

  test("a committed transaction in an abandoned block does not claim finality", async ({
    page,
  }) => {
    // Inclusion in an L2 block is not the end of the story: if the block's
    // finalization was abandoned, the transaction is committed and unsettled,
    // and calling that success would be the worst lie the page could tell.
    await page.goto(`/transaction/${await txInAbandonedBlock(page)}`);
    const journey = page.getByRole("region", { name: "Protocol journey" });
    await expect(journey.getByText("Finalization abandoned")).toBeVisible();
    await expect(journey.getByRole("list").getByText("Abandoned")).toBeVisible();
    await expect(journey.getByRole("list").getByText("Final on L1")).toHaveCount(0);
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
    await expect(page.getByText("Rejected by the node").first()).toBeVisible();
    await expect(page.getByText(/below minimum/)).toBeVisible();
    // The failure must read as a failure on the rail, not as a reached stage.
    const journey = page.getByRole("region", { name: "Protocol journey" });
    await expect(journey.getByRole("list").getByText("Rejected")).toBeVisible();
    // A rejected transaction never entered a block, so no settlement stage.
    await expect(journey.getByText("Final on L1")).toHaveCount(0);
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
    // The failure is scoped to the body: the journey comes from the node's own
    // records and must survive it.
    const journey = page.getByRole("region", { name: "Protocol journey" });
    await expect(journey).toBeVisible();
    await journey.getByText("Stage timings and evidence").click();
    await expect(journey.getByText("Node admission record", { exact: false })).toBeVisible();
  });

  test("a committed transaction links to its block and its L1 settlement state", async ({
    page,
  }) => {
    const rows = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows as Array<{ tx_id: string }>);
    await page.goto(`/transaction/${rows[0]!.tx_id}`);
    const journey = page.getByRole("region", { name: "Protocol journey" });
    // Inclusion is on the rail; the block link is evidence behind the details.
    await expect(journey.getByRole("list").getByText(/^Block #\d+$/)).toBeVisible();
    await journey.getByText("Stage timings and evidence").click();
    await expect(journey.getByRole("link", { name: /^Block #\d+$/ })).toBeVisible();
  });
});

test.describe("address detail", () => {
  test("warns that the balance undercounts when outputs failed to decode", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 1)}`);
    await expect(page.getByText("Balance is incomplete.")).toBeVisible();
    await expect(page.getByText(/Undercount/)).toBeVisible();
  });

  test("lists native assets held under its own tab", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 1)}?tab=assets`);
    await expect(page.getByText("Policy").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /MIDGARD|PATATE/ }).first()).toBeVisible();
  });

  test("breaks the balance into the UTxOs that produce it", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 1)}?tab=utxos`);
    await expect(rowRegion(page).locator("tr, li")).not.toHaveCount(0);
    // A UTxO the codec cannot read is listed and marked, never dropped: five
    // rows and a smaller total would be a quieter lie than six and a warning.
    await expect(page.getByText("Unreadable").first()).toBeVisible();
  });

  test("offers the request that produced the page", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 1)}?tab=raw`);
    await expect(page.getByText(/^curl -s /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy curl" })).toBeVisible();
  });

  test("does not warn when every output decoded", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 0)}`);
    await expect(page.getByText("Balance is incomplete.")).toHaveCount(0);
  });
});

test.describe("accessibility on populated pages", () => {
  // One test per route rather than one loop over all of them. A loop shares a
  // single timeout across nine axe runs, so a slow suite fails the whole sweep
  // without naming which page was at fault.
  for (const path of [
    "/",
    "/blocks",
    "/transactions",
    "/deposits",
    "/withdrawals",
    "/forced-transactions",
    "/assets",
  ]) {
    test(`${path} has no automated violations with real data`, async ({ page }) => {
      await page.goto(path);
      await expectNoViolations(page, path);
    });
  }

  test("a block page has no automated violations", async ({ page }) => {
    await page.goto(`/block/${await firstBlockHash(page)}`);
    await expectNoViolations(page, "/block/[hash]");
  });

  test("a transaction page has no automated violations", async ({ page }) => {
    await page.goto(`/transaction/${await txWithStatus(page, "committed")}`);
    await expectNoViolations(page, "/transaction/[hash]");
  });

  test("an address page has no automated violations", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 1)}`);
    await expectNoViolations(page, "/address/[address]");
  });

  test("an asset page has no automated violations", async ({ page }) => {
    const rows = await page.request
      .get(`${FIXTURE}/api/assets`)
      .then(async (r) => (await r.json()).rows as Array<{ policyId: string; assetName: string }>);
    await page.goto(`/asset/${rows[0]!.policyId}${rows[0]!.assetName}`);
    await expectNoViolations(page, "/asset/[unit]");
  });

  test("no violations in light theme with real data", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/deposits");
    await expectNoViolations(page, "/deposits (light)");
  });
});
