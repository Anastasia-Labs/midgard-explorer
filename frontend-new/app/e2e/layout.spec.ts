import { FIXTURE, expect, settle, test } from "./helpers";
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
  // Playwright passes the fixtures object first and the test info second, so
  // reaching the project name means naming a first parameter this hook does
  // not use.

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

/** Summary bands, measured at the widths where they used to break.
 *
 * The band's cells sit on a 1px gap that lets the container's border colour
 * through, which is what draws the hairline rule between them. The consequence
 * is that any part of the container not covered by a cell renders as a block of
 * border colour, and at phone width a three or five item band left exactly
 * that: a cell-sized rectangle that reads as a metric which failed to load.
 *
 * The bug survived a visual pass because the summary band does not have it at
 * 1440px, where enough tracks fit that no row is short. So this measures every
 * width, and asserts the property rather than any one component: every row of
 * cells in a hairline-gap container reaches that container's right edge, and no
 * value inside one is clipped. Written against the summary band, it immediately
 * found a second instance in the journey stage list.
 */
test.describe("summary band fills its rows", () => {

  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "sets its own viewports");
  });

  async function detailRoutes(page: import("@playwright/test").Page) {
    const get = async (path: string) => (await page.request.get(`${FIXTURE}${path}`)).json();

    const blocks = (await get("/api/blocks/1")).rows as Array<{ header_hash: string }>;
    const txs = (await get("/api/transactions/1")).rows as Array<{ tx_id: string }>;
    const deposits = (await get("/api/deposits/1")).rows as Array<{ ledger_address: string }>;
    const assets = (await get("/api/assets")).rows as Array<{
      policyId: string;
      assetName: string;
    }>;

    return [
      ["block", `/block/${blocks[0]!.header_hash}`],
      ["transaction", `/transaction/${txs[0]!.tx_id}`],
      ["address", `/address/${deposits[0]!.ledger_address}`],
      ["asset", `/asset/${assets[0]!.policyId}${assets[0]!.assetName}`],
    ] as const;
  }

  for (const width of ["narrow", "phone", "tablet", "desktop"] as const) {
    test(`no exposed border and no clipped value at ${width}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[width]);
      const routes = await detailRoutes(page);

      for (const [label, path] of routes) {
        await page.goto(path);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        // Without this the gap is read before the stylesheet applies, so every
        // band computes `normal` and the filter below finds nothing. The
        // failure then reads as "no hairline-gap container" rather than as the
        // timing race it is.
        await settle(page);
        // A collapsed <details> has no layout, so its contents would be
        // silently skipped rather than measured. The journey stage list lives
        // in one, and that is where the second instance of this defect was.
        await page.evaluate(() =>
          document.querySelectorAll("details").forEach((d) => (d.open = true)),
        );

        const bands = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("dl, ul, div")]
            // The hairline idiom: a container painted in the border colour
            // whose children sit on a 1px gap, so the gap is the rule between
            // them. Selecting on the mechanism rather than on a component name
            // means a new component that adopts the idiom is gated the day it
            // is written. Anything not laid out this way cannot expose a
            // background it does not have.
            .filter((el) => {
              const s = getComputedStyle(el);
              return (
                (s.display === "flex" || s.display === "grid") &&
                s.rowGap === "1px" &&
                s.columnGap === "1px" &&
                el.children.length > 1 &&
                el.getBoundingClientRect().width > 0
              );
            })
            .map((dl) => {
              const box = dl.getBoundingClientRect();
              const cells = [...dl.children].map((c) => {
                const r = c.getBoundingClientRect();
                const value = c.querySelector("dd > span");
                return {
                  top: Math.round(r.top),
                  right: r.right,
                  overflow: value ? value.scrollWidth - value.clientWidth : 0,
                };
              });
              // Cells sharing a top edge form a row. The last cell of each row
              // must reach the band's right edge, or the remainder is exposed
              // container background.
              const rows = new Map<number, number>();
              for (const c of cells) rows.set(c.top, Math.max(rows.get(c.top) ?? 0, c.right));
              return {
                right: box.right,
                rowRights: [...rows.values()],
                worstOverflow: Math.max(0, ...cells.map((c) => c.overflow)),
              };
            }),
        );

        expect(
          bands.length,
          `${label} at ${width} has no hairline-gap container, so this gate is measuring nothing`,
        ).toBeGreaterThan(0);

        for (const band of bands) {
          for (const rowRight of band.rowRights) {
            expect(
              band.right - rowRight,
              `${label} at ${width}: a summary row stops ${Math.round(
                band.right - rowRight,
              )}px short of the band, exposing container background`,
            ).toBeLessThanOrEqual(1.5);
          }
          expect(
            band.worstOverflow,
            `${label} at ${width}: a summary value is clipped by ${band.worstOverflow}px, ` +
              `so the figure on screen is not the figure it reports`,
          ).toBe(0);
        }
      }
    });
  }
});
