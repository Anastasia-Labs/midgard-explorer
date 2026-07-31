import { expect, test } from "@playwright/test";
import { FIXTURE } from "./helpers";
import {
  TX_GATES,
  VIEWPORTS,
  expectNoErrors,
  expectNoHorizontalOverflow,
  measure,
  reportTxLayout,
  watchForErrors,
} from "./layout";

/** Phase 1 layout gates.
 *
 * Runs in the `desktop` project only: it sets its own viewport sizes, so
 * running it twice would measure the same thing twice.
 *
 * `LAYOUT_MATRIX=full` runs every protocol state at every width (the
 * pre-merge gate). The default is the reduced per-commit set: the states whose
 * compositions differ most, at the two widths that bound the layout. */
const FULL = process.env.LAYOUT_MATRIX === "full";

const REDUCED_STATES = ["committed", "rejected", "some_future_status"] as const;

const WIDTHS = FULL
  ? (["narrow", "phone", "tablet", "desktop"] as const)
  : (["narrow", "phone"] as const);

test.describe("layout gates", () => {
  // This spec sets its own viewport sizes, so running it under both projects
  // would measure the same layout twice.
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "sets its own viewports");
  });

  /** Resolves one fixture transaction per lifecycle status. */
  async function txFor(page: import("@playwright/test").Page, status: string) {
    const rows = await page.request
      .get(`${FIXTURE}/api/transactions/1`)
      .then(async (r) => (await r.json()).rows as Array<{ tx_id: string }>);
    for (const row of rows) {
      const detail = await page.request.get(`${FIXTURE}/api/transaction?tx_hash=${row.tx_id}`);
      if (!detail.ok()) continue;
      if ((await detail.json()).status === status) return row.tx_id;
    }
    return null;
  }

  for (const status of REDUCED_STATES) {
    for (const width of WIDTHS) {
      test(`transaction ${status} at ${width}`, async ({ page }) => {
        const errors = watchForErrors(page);
        await page.setViewportSize(VIEWPORTS[width]);
        const hash = await txFor(page, status);
        test.skip(hash === null, `no fixture transaction with status ${status}`);
        await page.goto(`/transaction/${hash}`);
        await page.getByRole("heading", { level: 1 }).first().waitFor();

        const m = await measure(page);
        console.log(reportTxLayout(m, `${status} @ ${width}`));

        expectNoHorizontalOverflow(m, `transaction ${status} at ${width}`);
        expectNoErrors(errors, `transaction ${status} at ${width}`);

        // Size gates are phone-specific: they describe the first viewport of a
        // 390x844 device, not every width. They are targets for the journey
        // redesign, so they only assert under LAYOUT_GATES=enforce; otherwise
        // the measurement is logged and a red suite would hide real failures.
        if (width !== "phone" || process.env.LAYOUT_GATES !== "enforce") return;

        const journey = m.regions.journey;
        expect(journey, "journey region is not marked").toBeDefined();
        expect(
          journey!.height,
          `journey region is ${journey!.height}px, gate is ${TX_GATES.journeyMaxHeight}px`,
        ).toBeLessThanOrEqual(TX_GATES.journeyMaxHeight);
        expect(
          journey!.bottom,
          `the settlement answer ends at ${journey!.bottom}px, gate is ${TX_GATES.answerMaxBottom}px`,
        ).toBeLessThanOrEqual(TX_GATES.answerMaxBottom);
        if (m.tabsTop !== null) {
          expect(
            m.tabsTop,
            `tabs start at ${m.tabsTop}px, gate is ${TX_GATES.tabsMaxTop}px`,
          ).toBeLessThanOrEqual(TX_GATES.tabsMaxTop);
        }
      });
    }
  }
});
