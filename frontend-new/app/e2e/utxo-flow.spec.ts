import {
  expect,
  expectNoViolations,
  FIXTURE,
  settle,
  test,
  txWithStatus,
  txWithUnresolvedInput,
} from "./helpers";

/**
 * Phase 3: the UTxO flow.
 *
 * Shipped as a `Table | Flow` toggle over the State tab rather than as a tab of
 * its own, because both are renderings of the same inputs and outputs and a
 * separate tab would imply they hold different data. Table is the default: it
 * is the complete view, and the flow is the summary.
 */

const openState = async (page: import("@playwright/test").Page) => {
  const hash = await txWithStatus(page, "committed");
  await page.goto(`/transaction/${hash}?tab=utxo`);
  await settle(page);
  return hash;
};

const readyFlow = async (page: import("@playwright/test").Page) => {
  const flow = page.getByRole("group", { name: "UTxO flow" });
  await expect(flow).toHaveAttribute("data-layout-state", "static");
  return flow;
};

test.describe("the view toggle", () => {
  test("offers Table and Flow, with Table selected", async ({ page }) => {
    await openState(page);
    const group = page.getByRole("radiogroup", { name: /view/i });
    await expect(group.getByRole("radio")).toHaveText([/Table/, /Flow/]);
    await expect(group.getByRole("radio", { name: "Table" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("is linkable and survives a reload, like the tabs beside it", async ({ page }) => {
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    await expect(page).toHaveURL(/[?&]view=flow/);
    await page.reload();
    await settle(page);
    await expect(page.getByRole("radio", { name: "Flow" })).toHaveAttribute("aria-checked", "true");
  });

  test("moves between views with the arrow keys", async ({ page }) => {
    await openState(page);
    await page.getByRole("radio", { name: "Table" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Flow" })).toHaveAttribute("aria-checked", "true");
  });

  test("keeps the ledger equation visible in both views", async ({ page }) => {
    await openState(page);
    await expect(page.getByText(/inputs/i).first()).toBeVisible();
    await page.getByRole("radio", { name: "Flow" }).click();
    await expect(page.getByText(/inputs/i).first()).toBeVisible();
  });
});

test.describe("the flow itself", () => {
  test("renders a node per input and per output, and the transaction between them", async ({
    page,
  }) => {
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();

    const flow = await readyFlow(page);
    await expect(flow).toBeVisible();
    // The fixture's committed transactions carry two inputs and two outputs.
    await expect(flow.getByTestId("flow-node-input")).toHaveCount(2);
    await expect(flow.getByTestId("flow-node-output")).toHaveCount(2);
    await expect(flow.getByTestId("flow-node-transaction")).toHaveCount(1);
  });

  test("says in words that it draws no line from an input to an output", async ({ page }) => {
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    await readyFlow(page);
    // A UTxO transaction does not record which input funded which output. The
    // diagram must not let its own shape imply otherwise.
    await expect(page.getByText(/does not record which input funded which output/i)).toBeVisible();
  });

  test("marks a script address by more than colour", async ({ page }) => {
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    const flow = await readyFlow(page);
    // The fixture makes datum-bearing outputs script addresses.
    await expect(flow.getByText("Script").first()).toBeVisible();
  });

  test("says which input could not be resolved rather than drawing it as empty", async ({
    page,
  }) => {
    const hash = await txWithUnresolvedInput(page);
    await page.goto(`/transaction/${hash}?tab=utxo&view=flow`);
    const flow = await readyFlow(page);
    await expect(flow.getByText(/not resolvable/i).first()).toBeVisible();
  });

  /** The stacked layout under `lg` draws no connectors at all, so a legend
   * explaining line colour and line width there describes something the reader
   * cannot see. Help that names an absent encoding is worse than no help. */
  test("explains the lines only in the view that draws them", async ({ page }, testInfo) => {
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    const flow = await readyFlow(page);
    const legend = flow.getByTestId("flow-legend");
    const connectors = flow.getByTestId("flow-connectors").first();

    if (testInfo.project.name.includes("mobile")) {
      await expect(connectors).toBeHidden();
      await expect(legend).toBeHidden();
    } else {
      await expect(connectors).toBeVisible();
      await expect(legend).toBeVisible();
    }
  });

  /** A five node diagram stretched across a 1440px viewport puts its two
   * columns against the far edges with a void between them. Bounding the
   * diagram keeps the eye on the transaction rather than on the gap. */
  test("bounds the fitted diagram instead of stretching it to the viewport", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "single column, nothing to bound");
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    const flow = await readyFlow(page);
    const diagram = flow.getByTestId("flow-diagram");
    const box = await diagram.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(1000);
  });

  /** Every other fixture is 2-in 2-out, where both columns are the same height
   * and a line drawn against the wrong height still happens to land on its
   * card. This one is 1-in 3-out, so the shorter side is measurably wrong when
   * the column grid does not take the height its connectors take.
   *
   * The assertion is geometry, not a class name: where the line ends against
   * where the card is. A test naming `h-full` would pass on a stylesheet that
   * draws the diagram wrong. */
  test("ends every line on the card it belongs to, on unequal sides", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "the stacked layout draws no lines");
    const specimen = await page.request.get(`${FIXTURE}/__flow-unequal`).then((r) => r.json());
    await page.goto(`/transaction/${specimen.txId}?tab=utxo&view=flow`);
    const flow = await readyFlow(page);
    await expect(flow.getByTestId("flow-node-input")).toHaveCount(specimen.inputs);
    await expect(flow.getByTestId("flow-node-output")).toHaveCount(specimen.outputs);

    const offsets = await page.evaluate(() => {
      const centre = (el: Element) => {
        const box = el.getBoundingClientRect();
        return box.top + box.height / 2;
      };
      // `preserveAspectRatio="none"` over a 0-100 viewBox, so a viewBox unit is
      // a linear fraction of the rendered height.
      const endpoints = (svg: Element, end: "start" | "finish") => {
        const box = svg.getBoundingClientRect();
        return [...svg.querySelectorAll("path")].map((path) => {
          const numbers = (path.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?/g) ?? [];
          const unit = Number(end === "start" ? numbers[1] : numbers[numbers.length - 1]);
          return box.top + (unit / 100) * box.height;
        });
      };
      const svgs = [...document.querySelectorAll('[data-testid="flow-connectors"]')];
      const pair = (nodes: Element[], lines: number[]) =>
        nodes.map((node, i) => Math.abs(centre(node) - (lines[i] ?? Number.NaN)));
      return {
        inputs: pair(
          [...document.querySelectorAll('[data-testid="flow-node-input"]')],
          endpoints(svgs[0]!, "start"),
        ),
        outputs: pair(
          [...document.querySelectorAll('[data-testid="flow-node-output"]')],
          endpoints(svgs[1]!, "finish"),
        ),
      };
    });

    for (const offset of [...offsets.inputs, ...offsets.outputs]) {
      expect(offset).toBeLessThanOrEqual(2);
    }
  });

  /** Stacked on a phone, a card that sizes to its content leaves half the
   * screen empty beside it while the transaction card fills the width, so the
   * column reads as broken rather than as deliberate. */
  test("fills the width with stacked cards on a phone", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "columns sit side by side at desktop");
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    const flow = await readyFlow(page);

    const diagram = await flow.getByTestId("flow-diagram").boundingBox();
    const input = await flow.getByTestId("flow-node-input").first().boundingBox();
    expect(diagram).not.toBeNull();
    expect(input).not.toBeNull();
    expect(input!.width).toBeGreaterThan(diagram!.width * 0.9);
  });

  test("every node is a link a keyboard can reach", async ({ page }) => {
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    const flow = await readyFlow(page);
    await expect(flow).toBeVisible();

    // A diagram whose nodes are not links is a picture. Each input and output
    // node has to lead somewhere, and by keyboard, not only by click.
    for (const testId of ["flow-node-input", "flow-node-output"]) {
      const nodes = flow.getByTestId(testId);
      const count = await nodes.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        await expect(nodes.nth(i).getByRole("link").first()).toBeVisible();
      }
    }

    const first = flow.getByRole("link").first();
    await first.focus();
    await expect(first).toBeFocused();
  });

  test("keeps the connectors out of the accessibility tree", async ({ page }) => {
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    await readyFlow(page);
    const svg = page.locator("[data-testid='flow-connectors']").first();
    await expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  test("explains and renders ledger-backed edge encodings", async ({ page }, testInfo) => {
    const hash = await txWithUnresolvedInput(page);
    await page.goto(`/transaction/${hash}?tab=utxo&view=flow`);
    const flow = await readyFlow(page);
    // The legend travels with the connectors it explains, so it is present at
    // desktop widths and hidden in the stacked layout that draws no lines.
    const width = flow.getByText(/Width tracks lovelace/i);
    if (testInfo.project.name.includes("mobile")) await expect(width).toBeHidden();
    else await expect(width).toBeVisible();
    await expect(flow.locator('path[data-edge-resolved="false"]')).toHaveCount(1);
    await expect(flow.locator('path[data-edge-kind="Script"]').first()).toBeAttached();
    await expect(flow.locator('path[data-edge-kind="PubKey"]').first()).toBeAttached();
  });

  test("keeps ordinary transactions fitted without canvas controls", async ({ page }) => {
    await openState(page);
    await page.getByRole("radio", { name: "Flow" }).click();
    const flow = await readyFlow(page);
    await expect(flow.getByLabel("Interactive transaction UTxO graph")).toHaveCount(0);
    await expect(flow.locator(".mg-flow-minimap")).toHaveCount(0);
  });

  /** The canvas arrives as a separately fetched chunk, so "is it there yet" has
   * a real answer the page must publish rather than a duration a test has to
   * guess. Two runs of this suite failed on a five second visibility wait while
   * the chunk was still in flight, once on desktop and once on mobile, which is
   * a timing signature and not a defect. A state a test can wait on removes the
   * guess; a longer timeout would only have made the guess bigger. */
  test("publishes a canvas readiness state a reader and a test can both act on", async ({
    page,
  }) => {
    const specimen = await page.request.get(`${FIXTURE}/__flow-stress`).then((r) => r.json());
    await page.goto(`/transaction/${specimen.txId}?tab=utxo&view=flow`);
    const flow = await readyFlow(page);
    await expect(flow).toHaveAttribute("data-canvas-state", "idle");

    await page.getByRole("button", { name: /Open all 503 nodes/i }).click();
    await expect(flow).toHaveAttribute("data-canvas-state", /loading|ready/);
    await expect(flow).toHaveAttribute("data-canvas-state", "ready", { timeout: 15_000 });
  });

  test("provides canvas controls only after a large graph is opened", async ({
    page,
  }, testInfo) => {
    const specimen = await page.request.get(`${FIXTURE}/__flow-stress`).then((r) => r.json());
    await page.goto(`/transaction/${specimen.txId}?tab=utxo&view=flow`);
    const flow = await readyFlow(page);
    await page.getByRole("button", { name: /Open all 503 nodes/i }).click();
    await expect(flow).toHaveAttribute("data-canvas-state", "ready", { timeout: 15_000 });
    const graph = flow.getByLabel("Interactive transaction UTxO graph");
    await expect(graph).toBeVisible();
    await expect(graph.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(graph.getByRole("button", { name: "Zoom out" })).toBeVisible();
    await expect(graph.getByRole("button", { name: "Fit view" })).toBeVisible();
    if (testInfo.project.name.includes("mobile")) {
      await expect(graph.locator(".mg-flow-minimap")).toBeHidden();
    } else {
      await expect(graph.locator(".mg-flow-minimap")).toBeVisible();
    }
  });

  test("shows complete node details outside the fixed-height canvas card", async ({ page }) => {
    // Reveals and lays out 503 nodes, like the stress test below it. The click
    // waits for the button to be stable, which on a loaded machine outlasts the
    // default budget.
    test.slow();
    const specimen = await page.request.get(`${FIXTURE}/__flow-stress`).then((r) => r.json());
    await page.goto(`/transaction/${specimen.txId}?tab=utxo&view=flow`);
    await readyFlow(page);
    await page.getByRole("button", { name: /Open all 503 nodes/i }).click();
    const graph = page.getByLabel("Interactive transaction UTxO graph");
    const output = graph.getByTestId("flow-node-output").first();
    const expand = output.getByRole("button", { name: /^Show output .* details/ });
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect(output.getByRole("button", { name: /^Hide output .* details/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const inspector = page.getByRole("region", { name: /output .* details/i }).last();
    await expect(inspector).toBeVisible();
    await expect(inspector.locator("p.break-all.font-mono")).toHaveCount(2);
    await expect(inspector.locator("p.break-all.font-mono").first()).not.toContainText("…");
    await expect(inspector.locator("p.break-all.font-mono").last()).not.toContainText("…");
  });

  test("clusters first paint and positions all 503 stress nodes deterministically", async ({
    page,
  }) => {
    test.slow();
    const specimen = await page.request.get(`${FIXTURE}/__flow-stress`).then((r) => r.json());
    const started = Date.now();
    await page.goto(`/transaction/${specimen.txId}?tab=utxo&view=flow`);
    const flow = await readyFlow(page);
    await expect(page.getByTestId("flow-cluster-output")).toBeVisible();
    await expect(page.getByText(/503 nodes total/i)).toBeVisible();

    await page.getByRole("button", { name: /Open all 503 nodes/i }).click();
    await expect(flow).toHaveAttribute("data-layout-state", "interactive", { timeout: 10_000 });
    const canvas = page.getByRole("region", { name: "Large UTxO canvas" });
    await expect(canvas).toHaveAttribute("data-layout-state", "deterministic", { timeout: 10_000 });
    await expect(canvas.getByText(/503 nodes in deterministic transaction columns/i)).toBeVisible();
    const transactionCard = canvas.getByTestId("flow-node-transaction");
    await expect(transactionCard).toBeVisible();
    expect((await transactionCard.boundingBox())?.width ?? 0).toBeGreaterThan(150);
    expect(Date.now() - started).toBeLessThan(15_000);

    // React Flow owns all 503 model nodes, but viewport culling prevents all of
    // their rich card DOM from mounting simultaneously.
    const visibleNodes = page.locator(".react-flow__node");
    await expect(visibleNodes.first()).toBeAttached({ timeout: 3_000 });
    const mounted = await visibleNodes.count();
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(160);
  });

  test("removes graph movement when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const hash = await txWithStatus(page, "committed");
    await page.goto(`/transaction/${hash}?tab=utxo&view=flow`);
    const flow = await readyFlow(page);
    await expect(flow.locator(".react-flow__node")).toHaveCount(0);
    await expect(page.getByText(/does not record which input funded which output/i)).toBeVisible();
  });

  test("has no automated violations in either theme", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const hash = await txWithStatus(page, "committed");
      await page.goto(`/transaction/${hash}?tab=utxo&view=flow`);
      await readyFlow(page);
      await settle(page);
      await expectNoViolations(page, `transaction flow (${scheme})`);
    }
  });
});
