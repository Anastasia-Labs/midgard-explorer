#!/usr/bin/env node
/** Screenshot matrix for a design audit: viewport x colour scheme x route.
 *
 * The audit of 2026-07-31 told a reader to point `scripts/capture.mjs` at a
 * competitor, and no such file existed in this repository. This is that file.
 * It takes an arbitrary base URL precisely so the explorer and anything it is
 * being compared against go through an identical harness, because a comparison
 * between a capture and a memory is not a comparison.
 *
 * Usage:
 *   node scripts/capture.mjs --base http://127.0.0.1:3000 --out /tmp/audit
 *   node scripts/capture.mjs --base https://example.com --routes /,/blocks
 *   node scripts/capture.mjs --base ... --schemes dark --viewports phone
 *
 * Each route yields two shots per viewport and scheme: `-fold` at the real
 * viewport size, which is pixel-true and is what first impressions must be
 * judged from, and `-full` for rhythm and section proportion only. Full-page
 * captures expand the viewport, which can blank scroll-driven content and
 * downscale long pages, so a defect seen only there is not yet a defect.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const VIEWPORTS = {
  narrow: { width: 320, height: 720 },
  phone: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

const DEFAULT_ROUTES = [
  "/",
  "/blocks",
  "/transactions",
  "/deposits",
  "/withdrawals",
  "/forced-transactions",
  "/assets",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const base = args.base;
if (!base) {
  console.error("--base is required, e.g. --base http://127.0.0.1:3000");
  process.exit(2);
}

const out = args.out ?? "/tmp/design-audit";
const routes = (args.routes ?? DEFAULT_ROUTES.join(",")).split(",").filter(Boolean);
const schemes = (args.schemes ?? "light,dark").split(",").filter(Boolean);
const viewports = (args.viewports ?? "phone,desktop").split(",").filter(Boolean);

for (const v of viewports) {
  if (!VIEWPORTS[v]) {
    console.error(`unknown viewport "${v}"; known: ${Object.keys(VIEWPORTS).join(", ")}`);
    process.exit(2);
  }
}

const slug = (route) => (route === "/" ? "index" : route.replace(/^\//, "").replace(/\//g, "-"));

/** Phrases that mean the shot is of a bot check rather than of the site.
 *
 * Pointing this at a public explorer returns an interstitial that screenshots
 * perfectly well, so the run reports success and writes a picture of nothing.
 * A comparison scored from those would be worse than no comparison, because it
 * would look like evidence. Detected and refused rather than saved. */
const CHALLENGE = [
  /performing security verification/i,
  /verify you are (a )?human/i,
  /checking your browser/i,
  /enable javascript and cookies to continue/i,
  /just a moment/i,
  /access denied/i,
  /unusual traffic/i,
];

async function challengeReason(page, status) {
  if (status !== null && (status === 403 || status === 429 || status === 503)) {
    return `HTTP ${status}`;
  }
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "");
  const hit = CHALLENGE.find((re) => re.test(text));
  return hit ? `bot check: ${hit.source.replace(/\\/g, "")}` : null;
}

await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const written = [];
const failures = [];

for (const viewport of viewports) {
  for (const scheme of schemes) {
    const context = await browser.newContext({
      viewport: VIEWPORTS[viewport],
      colorScheme: scheme,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    for (const route of routes) {
      const name = `${slug(route)}-${viewport}-${scheme}`;
      try {
        const res = await page.goto(base + route, { waitUntil: "load", timeout: 30_000 });
        // Fonts and any entry animation both move text after load, and a shot
        // taken mid-fade measures colours that do not exist at rest.
        await page.evaluate(() => document.fonts?.ready);
        await page
          .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), {
            timeout: 5_000,
          })
          .catch(() => {});

        const blocked = await challengeReason(page, res?.status() ?? null);
        if (blocked !== null) {
          failures.push({ route, viewport, scheme, error: `not the site (${blocked})` });
          continue;
        }

        await page.screenshot({ path: join(out, `${name}-fold.png`) });
        await page.screenshot({ path: join(out, `${name}-full.png`), fullPage: true });
        written.push({ route, viewport, scheme, status: res?.status() ?? null });
      } catch (error) {
        failures.push({ route, viewport, scheme, error: String(error).split("\n")[0] });
      }
    }

    await context.close();
  }
}

await browser.close();

// A manifest, so a report can cite a shot rather than describe one.
await writeFile(
  join(out, "manifest.json"),
  JSON.stringify({ base, capturedAt: new Date().toISOString(), written, failures }, null, 2),
);

console.log(`${written.length} captures in ${out}`);
for (const f of failures) console.log(`FAILED ${f.route} ${f.viewport} ${f.scheme}: ${f.error}`);
process.exit(failures.length > 0 && written.length === 0 ? 1 : 0);
