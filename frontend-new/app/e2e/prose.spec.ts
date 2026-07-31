import { FIXTURE, expect, test } from "./helpers";

/** Catches words glued together by a space JSX dropped.
 *
 * In this Next 16 / Turbopack setup the space between an expression or element
 * and the text following it on the same line is sometimes not emitted. It is
 * positional, not universal: `all {n} spendable UTxOs` is fine while
 * `{a} of {b} inputs` renders "2inputs" and `<strong>Received</strong> is
 * exact` renders "Receivedis exact".
 *
 * Three of those shipped and survived a full screenshot review, because one
 * missing space inside a paragraph is invisible at a glance and invisible in
 * the source. Only the rendered DOM shows it, which is why this is a test and
 * not a code review rule. It matters most right after Prettier reflows JSX,
 * since that is exactly when a working line gets rewrapped into a broken one.
 */

/** Two shapes the defect takes: a lowercase run butting into a capitalised
 * word ("Receivedis"), and a number butting into a word ("2inputs"). */
const GLUE = /[a-z]{2}[A-Z][a-z]{2}|\b\d+[a-z]{4,}/;

test.describe("rendered prose", () => {
  test.slow();

  test("no route renders two words glued together", async ({ page }) => {
    const get = async (path: string) => (await page.request.get(`${FIXTURE}${path}`)).json();
    const blocks = await get("/api/blocks/1");
    const txs = await get("/api/transactions/1");
    const deposits = await get("/api/deposits/1");
    const assets = await get("/api/assets");

    const routes = [
      "/",
      "/blocks",
      "/transactions",
      "/deposits",
      "/withdrawals",
      "/forced-transactions",
      "/assets",
      `/block/${blocks.rows[0].header_hash}`,
      `/transaction/${txs.rows[0].tx_id}`,
      `/address/${deposits.rows[0].ledger_address}`,
      `/asset/${assets.rows[0].policyId}${assets.rows[0].assetName}`,
      "/no-such-route",
      "/block/not-a-hash",
    ];

    const offenders: string[] = [];

    for (const route of routes) {
      await page.goto(route);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      // Disclosures hold a third of the prose on the detail pages.
      await page.evaluate(() =>
        document.querySelectorAll("details").forEach((d) => (d.open = true)),
      );

      const hits = await page.evaluate((source) => {
        const re = new RegExp(source);
        const skipTags = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TIME"]);
        const found: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement;
          if (!el || skipTags.has(el.tagName)) continue;
          if (getComputedStyle(el).fontFamily.includes("mono")) continue;

          const text = (node.textContent ?? "").trim();
          // Identifiers are single tokens, usually elided with an ellipsis, and
          // a hex run trips the digits-then-letters rule constantly. The defect
          // is a missing space inside a sentence, so require a sentence.
          if (!text.includes(" ") || text.includes("…")) continue;
          if (re.test(text)) found.push(text.slice(0, 120));
        }
        return found;
      }, GLUE.source);

      offenders.push(...hits.map((h) => `${route}: ${h}`));
    }

    expect(
      offenders,
      "text nodes look like a JSX space was dropped; write the sentence as one " +
        'template string or add an explicit {" "}',
    ).toEqual([]);
  });
});
