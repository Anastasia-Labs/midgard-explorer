import type { Page } from "@playwright/test";
import {
  FIXTURE,
  expect,
  expectNoViolationsInBothThemes,
  firstBlockHash,
  isNarrow,
  rowRegion,
  settle,
  test,
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

  test("a deposit-only header has no synthetic height and opens by hash", async ({ page }) => {
    const response = await page.request.get(`${FIXTURE}/api/blocks/1`);
    const body = await response.json();
    const row = body.rows.find((candidate: { height: number | null }) => candidate.height === null);
    expect(row).toBeDefined();
    expect(row.header_hash).toBe("6f77bd238790f437971176e41b6c04ecf8eb04af01cf6c8fedfbcc8b");

    await page.goto(`/block/${row.header_hash}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Header");
    await expect(page.getByText("Block #0", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("This header contains protocol events but no Midgard transactions."),
    ).toBeVisible();

    await page.getByRole("tab", { name: /Data availability/ }).click();
    await expect(page.getByText("Payload retained locally.")).toBeVisible();

    await page.getByRole("tab", { name: /Protocol events/ }).click();
    await expect(page.getByRole("heading", { name: /Deposits/ })).toContainText("(1)");
    await expect(page.getByText(/published|attested|DA-network available/i)).toHaveCount(0);
  });

  test("shows the independently indexed Cardano header evidence", async ({ page }) => {
    await page.goto(`/block/${await firstBlockHash(page)}?tab=l1`);
    await expect(page.getByText("Observed on Cardano.", { exact: true })).toBeVisible();
    await expect(page.getByText("Protocol version", { exact: true })).toBeVisible();
    await expect(page.getByText("Operator key hash", { exact: true })).toBeVisible();
    await expect(page.getByText(/published|attested|DA-network available/i)).toHaveCount(0);
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

  test("deposit ledger IDs are not linked as ordinary Midgard transactions", async ({ page }) => {
    const deposits = await page.request
      .get(`${FIXTURE}/api/deposits/1`)
      .then(async (response) => (await response.json()).rows as Array<{ ledger_tx_id: string }>);
    const id = deposits[0]!.ledger_tx_id;
    await page.goto("/deposits");
    await expect(page.locator(`a[href="/transaction/${id}"]`)).toHaveCount(0);
  });

  test("reconciles node deposits with the explorer-owned Cardano index", async ({ page }) => {
    await page.goto("/deposits");
    const observations = page.getByText(/Cardano observations \(\d+\)/);
    await expect(observations).toBeVisible();
    await observations.click();
    await expect(
      page.getByText(/current node records|Additional Cardano observations/),
    ).toBeVisible();
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

  test("withdrawals show the canonical bech32 address and decoded value", async ({ page }) => {
    await page.goto("/withdrawals");
    await expect(
      rowRegion(page)
        .getByText(/addr_test1/)
        .first(),
    ).toBeVisible();
    await expect(rowRegion(page).getByText(/₳/).first()).toBeVisible();
  });

  test("withdrawal outrefs are not linked as transaction hashes", async ({ page }) => {
    const withdrawals = await page.request
      .get(`${FIXTURE}/api/withdrawals/1`)
      .then(async (response) => (await response.json()).rows as Array<{ l2_outref: string }>);
    const outref = withdrawals[0]!.l2_outref;
    await page.goto("/withdrawals");
    await expect(page.locator(`a[href="/transaction/${outref}"]`)).toHaveCount(0);
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

  /** The deposits row is the one place both ledgers' addresses sit side by
   * side, which makes it the check that matters: whatever the rule is, it has
   * to be the same rule in both columns. */
  test("marks the Midgard address and the Cardano one it came from", async ({ page }) => {
    // 1600, not 1440: the Cardano source column is hidden below `2xl`, so at
    // desktop width this found no column, asserted nothing behind a guard, and
    // passed. The first version of this test did exactly that.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/deposits");
    await settle(page);

    await expect(page.getByRole("columnheader", { name: "Cardano source" })).toBeVisible();

    // Both addresses in one row: the Midgard recipient, which links to its page
    // here, and the Cardano source, which links nowhere because this explorer
    // has no page for it. The rule that has to hold is that neither is bare.
    const row = rowRegion(page)
      .getByRole("row")
      .filter({ hasText: /addr_test/ })
      .first();
    await expect(row.locator('svg[viewBox="0 0 5 5"]')).toHaveCount(2);
  });

  test("known deposit statuses stay readable at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/deposits");
    await settle(page);

    const projected = rowRegion(page).getByText("Projected", { exact: true }).first();
    await expect(projected).toBeVisible();
    const layout = await projected.evaluate((element) => {
      const tableScroller = element.closest("table")?.parentElement;
      const label = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "Projected",
      );
      if (!label) throw new Error("Projected badge has no direct label text node");
      const range = document.createRange();
      // Measure the label, not the marker and help control that share its
      // badge. Each inline child has its own client rectangle even when all
      // three occupy the same line.
      range.selectNodeContents(label);
      return {
        lineBoxes: range.getClientRects().length,
        pageWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        tableScroller: tableScroller
          ? {
              className: tableScroller.className,
              clientWidth: tableScroller.clientWidth,
              scrollWidth: tableScroller.scrollWidth,
              overflowX: getComputedStyle(tableScroller).overflowX,
              right: Math.round(tableScroller.getBoundingClientRect().right),
            }
          : null,
      };
    });

    expect(layout.lineBoxes, "Projected split across multiple lines").toBe(1);
    expect(layout.tableScroller, "deposits table has no scroll container").not.toBeNull();
    expect(layout.tableScroller!.overflowX).toBe("auto");
    expect(
      layout.tableScroller!.scrollWidth,
      `deposits table needs internal scrolling at desktop width: ${layout.tableScroller!.scrollWidth}px > ${layout.tableScroller!.clientWidth}px`,
    ).toBeLessThanOrEqual(layout.tableScroller!.clientWidth + 1);
    expect(
      layout.pageScrollWidth,
      `deposits page overflows: ${layout.pageScrollWidth}px > ${layout.pageWidth}px`,
    ).toBeLessThanOrEqual(layout.pageWidth + 1);
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

test.describe("list filtering and export", () => {
  test("a status filter narrows the whole list, not just the page in view", async ({ page }) => {
    await page.goto("/blocks");
    const total = async () => {
      const text = await page.getByText(/total blocks/).textContent();
      return Number((text ?? "").replace(/[^0-9]/g, ""));
    };
    const before = await total();

    await page.getByLabel("L1 settlement").selectOption("finalized");
    await expect(page).toHaveURL(/status=finalized/);
    // Polled, not read once. The URL changes before the filtered total is
    // rendered, so a single read observes the pre-filter figure whenever the
    // re-render lands late, and the result then depends on how busy the machine
    // is rather than on the code. A control that filtered only the rows that
    // happened to arrive leaves the total untouched forever, so this still
    // fails for the reason it exists.
    await expect.poll(total).toBeLessThan(before);
    expect(await total()).toBeGreaterThan(0);
  });

  test("the filtered view survives being copied out of the address bar", async ({ page }) => {
    await page.goto("/blocks?status=finalized");
    await expect(page.getByLabel("L1 settlement")).toHaveValue("finalized");
    await expect(rowRegion(page).locator("tr, li")).not.toHaveCount(0);
  });

  test("changing the filter returns to the first page", async ({ page }) => {
    await page.goto("/blocks?page=2");
    await page.getByLabel("L1 settlement").selectOption("finalized");
    await expect(page).not.toHaveURL(/page=2/);
  });

  test("export covers the rows in view and says how many", async ({ page }) => {
    await page.goto("/blocks");
    const tools = page.locator('[data-region="list-tools"]');
    await expect(tools.getByText(/rows in view/)).toBeVisible();
    const download = page.waitForEvent("download");
    await tools.getByRole("button", { name: "CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^midgard-blocks-page-1\.csv$/);
  });

  test("the transactions list filters and exports too", async ({ page }) => {
    await page.goto("/transactions");
    await expect(page.getByLabel("L1 settlement")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.locator('[data-region="list-tools"]').getByRole("button", { name: "JSON" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
  });
});

test.describe("operational metrics", () => {
  test("answers whether the chain is healthy before anything else", async ({ page }) => {
    await page.goto("/");
    const metrics = page.locator('[data-region="metrics"]');
    await expect(metrics).toBeVisible();
    await expect(metrics.getByText("Chain tip")).toBeVisible();
    await expect(metrics.getByText("Awaiting settlement")).toBeVisible();
  });

  // Latency distributions answer "how fast is it usually", which is a deeper
  // question than "is it moving". Keeping them out of the top row is what lets
  // that row be read at a glance, so their being in the disclosure is the
  // behaviour under test, not an accident of layout.
  test("keeps latency distributions out of the first read", async ({ page }) => {
    await page.goto("/");
    const metrics = page.locator('[data-region="metrics"]');
    await expect(metrics.getByText("Cardano settlement time")).toHaveCount(0);

    await page.getByText("Latency, status breakdown and where each figure comes from").click();
    await expect(page.getByText("Cardano settlement time")).toBeVisible();
    await expect(page.getByText("Admission", { exact: true })).toBeVisible();
  });

  test("states a health verdict in words, above the figures", async ({ page }) => {
    // The panel used to be five figures of equal weight under a heading
    // reading "Network health", and never said whether health was good. The
    // reader had to know that a 33% abandonment rate is bad, which is exactly
    // the knowledge someone arriving at an explorer does not have.
    await page.goto("/");
    const verdict = page.locator('[data-region="verdict"]');
    await expect(verdict).toBeVisible();

    // The fixture chain abandons a third of its settlements, so the verdict
    // must not be the reassuring one. A green light on a degraded chain is the
    // single worst thing this panel could do.
    await expect(verdict).toContainText(/not everything is settling|falling behind|stopped/i);

    // Every reason cites a figure, so a reader can disagree with the judgement.
    const reasons = await verdict.locator("li").allInnerTexts();
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) expect(reason).toMatch(/\d/);

    // It outranks the figures, or it is just another line on a busy panel.
    const sizes = await verdict.evaluate((el) => ({
      headline: parseFloat(getComputedStyle(el.querySelector("p > span:last-child")!).fontSize),
    }));
    const figure = await page
      .locator('[data-region="metrics"] span')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(sizes.headline).toBeGreaterThan(figure);
  });

  test("labels a percentile drawn from too few records", async ({ page }) => {
    await page.goto("/");
    // The fixture settles only a handful of blocks, which is exactly the case
    // where a p95 must not be presented as a measurement. The percentiles now
    // sit in the disclosure, and the label has to travel with them: a figure
    // may be moved out of the first read, but it may never be shown anywhere
    // without the sample it was measured over.
    await page.getByText("Latency, status breakdown and where each figure comes from").click();
    await expect(page.getByText(/thin sample/).first()).toBeVisible();
  });

  // The corollary, and the reason moving them was safe: no percentile survives
  // in the top row, so collapsing the disclosure cannot leave an unqualified
  // distribution on screen.
  test("shows no percentile outside the disclosure that carries its sample", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-region="metrics"]').getByText(/p95/)).toHaveCount(0);
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
    await page.getByText("Latency, status breakdown and where each figure comes from").click();
    await expect(
      page.getByText("tx_admissions.terminal_at - tx_admissions.first_seen_at"),
    ).toBeVisible();
    await expect(
      page.getByText(
        "pending_block_finalizations.status, pending_block_finalizations.block_end_time, blocks.height",
      ),
    ).toBeVisible();
  });

  test("links the oldest block still waiting on L1", async ({ page }) => {
    await page.goto("/");
    const oldest = page.getByText("Oldest block awaiting settlement").locator("..");
    await expect(oldest.getByRole("link")).toBeVisible();
    await oldest.getByRole("link").click();
    await expect(page).toHaveURL(/\/block\/[0-9a-f]{56}/);
  });

  test("the panel survives a metrics failure without blanking the page", async ({ page }) => {
    await page.request.post(`${FIXTURE}/__control?fail=metrics`);
    try {
      await page.goto("/");
      // The panel says it cannot judge, in the same grammar it uses when it
      // can. A panel that answers only when things are fine teaches a reader
      // that silence means trouble.
      const verdict = page.locator('[data-region="verdict"]');
      await expect(verdict).toContainText("cannot be judged");
      await expect(page.getByText(/Everything else on this page is unaffected/)).toBeVisible();
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
    await expect(rowRegion(page)).toBeVisible();
    // The fingerprint is the identifier worth comparing; a display name is not
    // unique and a policy ID is 56 characters of noise.
    await expect(
      rowRegion(page)
        .getByText(/^asset1/)
        .first(),
    ).toBeVisible();
  });

  test("a readable name is shown as text, with its bytes alongside", async ({ page }) => {
    await page.goto("/assets");
    await expect(rowRegion(page)).toBeVisible();
    await expect(rowRegion(page).getByText("MIDGARD").first()).toBeVisible();
    await expect(rowRegion(page).getByText("PATATE").first()).toBeVisible();
  });

  test("bytes that are not text stay hex rather than becoming a guess", async ({ page }) => {
    await page.goto("/assets");
    await expect(rowRegion(page)).toBeVisible();
    await expect(rowRegion(page).getByText("fffe0102").first()).toBeVisible();
  });

  test("a name carrying a bidi override is never rendered as text", async ({ page }) => {
    // "USD" + U+202E + "C" renders as "USDC" reversed, which is how one token
    // is made to read as another. It must appear as its bytes.
    await page.goto("/assets");
    await expect(rowRegion(page)).toBeVisible();
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
    // Scoped to the page body: the search dialog's help text also mentions
    // asset1..., and it is present but hidden.
    await expect(
      page
        .getByRole("main")
        .getByText(/^asset1/)
        .first(),
    ).toBeVisible();
  });

  test("the asset page says its total describes the ledger now, not history", async ({ page }) => {
    const rows = await roster(page);
    await page.goto(`/asset/${rows[0]!.policyId}${rows[0]!.assetName}`);
    await expect(page.getByText(/Current ledger · .* spendable UTxOs scanned/)).toBeVisible();
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

  test("a malformed asset unit responds with HTTP 404", async ({ page }) => {
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
    await expect(journey.getByRole("list").getByText("Seen on Cardano")).toBeVisible();
    await journey.getByText("Settlement timings and evidence").click();
    await expect(journey.getByRole("group").getByText("Queued for Cardano")).toBeVisible();

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
  test("keeps the explorer-style technical overview for Midgard transactions", async ({ page }) => {
    await page.goto(`/transaction/${await txAwaitingFinality(page)}`);
    const overview = page.getByRole("tabpanel");
    await expect(overview.getByRole("heading", { name: "Technical details" })).toBeVisible();
    // Fee is on the summary band above the tabs and is deliberately not
    // repeated inside Technical details. The reader still sees it once, which
    // is what this test is for; asserting it twice was asserting the
    // duplication.
    await expect(
      page.locator('[data-region="summary"]').getByText("Fee", { exact: true }),
    ).toBeVisible();
    await expect(overview.getByText("Fee", { exact: true })).toHaveCount(0);
    await expect(overview.getByText("Validity interval", { exact: true })).toBeVisible();
    await expect(overview.getByText("Network ID", { exact: true })).toBeVisible();
    await expect(overview.getByText("Format version", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What this transaction does" })).toHaveCount(0);
    // The summary states a transfer or renders nothing. Its old fallback,
    // "Applied 2 inputs and created 2 outputs", spent a band above the fold
    // restating the counts the State tab already carries on its tab badge.
    await expect(page.getByText(/Applied \d+ inputs? and created \d+ outputs?\./)).toHaveCount(0);
  });

  test("states a transfer when one address ends up net positive", async ({ page }) => {
    const payment = await page.request.get(`${FIXTURE}/__payment-tx`).then((r) => r.json());
    await page.goto(`/transaction/${payment.txId}`);
    await expect(page.getByText(/Transferred value to/)).toBeVisible();
  });

  test("a committed transaction shows the completed lifecycle and its inputs and outputs", async ({
    page,
  }) => {
    const hash = await txAwaitingFinality(page);
    await page.goto(`/transaction/${hash}`);
    // One journey replaces the lifecycle chips, admission timeline and
    // settlement band; per-stage timings live behind its disclosure.
    const journey = page.getByRole("region", { name: "Protocol journey" });
    await expect(journey).toBeVisible();
    // The outcome is stated once, as the record header's badge. It used to be
    // stated here as well, and beside it the page header carried the node's raw
    // code, so a settled transaction read "Committed" and "Final on Cardano"
    // within one screen of each other.
    await expect(
      page.locator('[data-region="identity"]').getByText("Committed, awaiting Cardano finality"),
    ).toBeVisible();
    await expect(journey.getByText("Committed, awaiting Cardano finality")).toHaveCount(0);
    await journey.getByText("Stage timings and evidence").click();
    // The label appears on the rail and again in the details grid; the details
    // entry is the one that carries the recorded timestamp.
    await expect(journey.getByRole("group").getByText("Validated")).toBeVisible();
    // The tab was renamed to "State" in Phase 2: it is what the reference
    // explorers call the section, and "UTxO flow" now names the diagram inside
    // it rather than the section itself.
    await page.getByRole("tab", { name: /State/ }).click();
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

    // With an unresolved input there is no number that is the input total, so
    // the equation must not put one on the left of its "=". An earlier version
    // rendered "At least ₳9.501 = ₳4.7 + ₳0.171", which is a false statement
    // made in the one place on the page whose whole purpose is to be true.
    await page.goto(`/transaction/${partial}?tab=utxo`);
    await expect(ledger.getByText("Not known in full")).toBeVisible();
    await expect(ledger.getByText(/is visible/)).toBeVisible();
    // The caption states the same fact in fewer words than it used to: an
    // unknown input total, and why. What must never come back is a number on
    // the left of the "=", which the "At least" assertion below still guards.
    await expect(ledger.getByText(/Input total unknown/)).toBeVisible();
    await expect(ledger.getByText(/spend side unknown/).first()).toBeVisible();

    // The equation row itself: every amount it states must belong to a side
    // that is actually known. Reading the row's own text is what catches a
    // reintroduced lower bound, which no assertion about a caption would.
    const row = ledger.locator("div").first();
    await expect(row).not.toContainText("At least");
  });

  test("a committed transaction in an abandoned block does not claim finality", async ({
    page,
  }) => {
    // Inclusion in an L2 block is not the end of the story: if the block's
    // finalization was abandoned, the transaction is committed and unsettled,
    // and calling that success would be the worst lie the page could tell.
    await page.goto(`/transaction/${await txInAbandonedBlock(page)}`);
    const journey = page.getByRole("region", { name: "Protocol journey" });
    // The outcome is the record header's badge; the rail carries the stage.
    await expect(
      page.locator('[data-region="identity"]').getByText("Finalization abandoned"),
    ).toBeVisible();
    await expect(journey.getByRole("list").getByText("Abandoned")).toBeVisible();
    await expect(journey.getByRole("list").getByText("Final on Cardano")).toHaveCount(0);
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
    await expect(journey.getByText("Final on Cardano")).toHaveCount(0);
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
  test("uses paged, finalization-aware history with complete values", async ({ page }) => {
    const address = await fixtureAddress(page, 0);
    const response = await page.request.get(
      `${FIXTURE}/api/address?address=${encodeURIComponent(address)}&page=1`,
    );
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.historyPage).toBe(1);
    expect(body.limit).toBe(25);
    expect(body.txCount).toBeGreaterThanOrEqual(body.history.length);
    expect(body.history[0].received).toEqual(
      expect.objectContaining({ lovelace: expect.any(String), assets: expect.any(Object) }),
    );
    expect(
      body.history.some(
        (row: { finalization_status: string | null }) => row.finalization_status !== null,
      ),
    ).toBe(true);
  });

  test("shows settlement and native-asset movement in activity", async ({ page }) => {
    await page.goto(`/address/${await fixtureAddress(page, 0)}`);
    if (await isNarrow(page)) {
      await page.getByText("Details", { exact: true }).first().click();
      await expect(page.getByText("L1 settlement", { exact: true }).first()).toBeVisible();
    } else {
      await expect(page.getByRole("columnheader", { name: "L1 settlement" })).toBeVisible();
    }
    await expect(page.getByText(/MIDGARD|PATATE/).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible();
  });

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
  //
  // Each test audits light and dark and asserts they rendered differently. The
  // previous version audited whatever `prefers-color-scheme` Playwright happens
  // to emulate, which is light, on every route, and then added one test that
  // asked for light again. Dark shipped unaudited while the report said
  // otherwise.
  //
  // Two full axe passes over a populated page do not fit the default 30s on
  // every route. Marked slow rather than trimmed: the budget is the thing that
  // should give here, not the coverage.
  test.slow();
  for (const path of [
    "/",
    "/blocks",
    "/transactions",
    "/deposits",
    "/withdrawals",
    "/forced-transactions",
    "/assets",
  ]) {
    test(`${path} has no automated violations with real data in either theme`, async ({ page }) => {
      await expectNoViolationsInBothThemes(page, path);
    });
  }

  test("a block page has no automated violations in either theme", async ({ page }) => {
    await expectNoViolationsInBothThemes(page, `/block/${await firstBlockHash(page)}`);
  });

  test("a transaction page has no automated violations in either theme", async ({ page }) => {
    await expectNoViolationsInBothThemes(
      page,
      `/transaction/${await txWithStatus(page, "committed")}`,
    );
  });

  test("an address page has no automated violations in either theme", async ({ page }) => {
    await expectNoViolationsInBothThemes(page, `/address/${await fixtureAddress(page, 1)}`);
  });

  test("an asset page has no automated violations in either theme", async ({ page }) => {
    const rows = await page.request
      .get(`${FIXTURE}/api/assets`)
      .then(async (r) => (await r.json()).rows as Array<{ policyId: string; assetName: string }>);
    await expectNoViolationsInBothThemes(page, `/asset/${rows[0]!.policyId}${rows[0]!.assetName}`);
  });
});
