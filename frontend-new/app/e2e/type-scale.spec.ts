import { FIXTURE, expect, test } from "./helpers";
import { undersizedText } from "./layout";

/** The floor, measured on rendered text rather than argued from source.
 *
 * `text-[10px]` in a component is not the claim being made. The claim is that
 * nothing a reader is shown renders below the floor, and only the DOM knows
 * that: a size can arrive from a token, from a `mg-*` utility, from an
 * inherited `font-size`, from a `<kbd>` or `<sub>` the UA shrinks on its own,
 * or from a component that has been restyled since anyone last read it. A grep
 * over `src/` sees the first of those and none of the rest, which is why
 * `scripts/type-scale-check.mjs` is a separate gate answering a separate
 * question. That one stops new literals being written. This one is the
 * accessibility claim.
 *
 * Both projects run it. The desktop table is `hidden` below `sm` and the ledger
 * rows are hidden above it, so each viewport renders text the other never
 * builds, and a single-project run would report a floor for half the tree while
 * looking exactly like a run that covered all of it.
 *
 * FLOOR is house style, not a conformance threshold. WCAG 2.1 sets no minimum
 * font size at any level, and size does not enter the contrast ratio: 1.4.3's
 * only interaction with size relaxes the requirement above 18pt rather than
 * tightening it below. `--mg-text-3` is separately documented in tokens.css as
 * clearing 4.5:1 on all four surfaces. So this gate is defended on legibility
 * of mono identifiers and small caps at arm's length, and nothing here should
 * be cited as a WCAG obligation.
 */
const FLOOR = 12;

/** Text the floor does not govern. `<sup>`/`<sub>` are shrunk by the UA
 * relative to whatever contains them, so holding them to the floor would mean
 * setting them larger than the body text they annotate. */
const EXEMPT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SUP", "SUB"]);

test.describe("type scale", () => {
  test.slow();

  test(`no rendered text sits below ${FLOOR}px`, async ({ page }) => {
    const get = async (path: string) => (await page.request.get(`${FIXTURE}${path}`)).json();
    const blocks = await get("/api/blocks/1");
    const txs = await get("/api/transactions/1");
    const deposits = await get("/api/deposits/1");
    const assets = await get("/api/assets");

    /** One route per composition, matching the reasoning in prose.spec.ts: the
     * densest small-text surfaces are the tables, the script viewers, the
     * identity bar and the shell, and every one of them is reached here. */
    const routes = [
      "/",
      "/blocks",
      "/transactions",
      "/deposits",
      "/withdrawals",
      "/forced-transactions",
      "/assets",
      "/l1",
      "/api-docs",
      `/block/${blocks.rows[0].header_hash}`,
      `/transaction/${txs.rows[0].tx_id}`,
      `/address/${deposits.rows[0].ledger_address}`,
      `/asset/${assets.rows[0].policyId}${assets.rows[0].assetName}`,
      "/no-such-route",
    ];

    const offenders: string[] = [];

    for (const route of routes) {
      await page.goto(route);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      // The script and CBOR viewers, which hold the smallest type in the app,
      // are behind disclosures. Measuring with them closed would miss the
      // worst case on the page and pass.
      await page.evaluate(() =>
        document.querySelectorAll("details").forEach((d) => (d.open = true)),
      );

      const hits = await undersizedText(page, FLOOR, [...EXEMPT_TAGS]);

      offenders.push(...hits.map((h) => `${route}\n    ${h}`));
    }

    expect(
      offenders,
      `text renders below the ${FLOOR}px floor. Each line is route, then size, ` +
        `element and a sample:\n  ${offenders.join("\n  ")}\n`,
    ).toEqual([]);
  });
});
