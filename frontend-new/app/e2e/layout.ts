import { expect, type Page } from "@playwright/test";
import { settle } from "./helpers";

/** Layout measurement harness.
 *
 * Responsive claims were impressions until this existed. It measures real
 * boxes in the production build (playwright.config.ts runs `next build &&
 * next start`, so dev-mode overlays and hydration timing never reach these
 * numbers) and turns each gate into a pass/fail with the measured value in the
 * failure message.
 *
 * Regions are located by `data-region`, not by class or nesting, so the same
 * measurement survives a component being replaced. That is the point: the
 * before and after of the journey redesign are the same measurement. */

export const VIEWPORTS = {
  narrow: { width: 320, height: 720 },
  phone: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

export type Region = { top: number; height: number; bottom: number };

export type PageMetrics = {
  docHeight: number;
  docWidth: number;
  scrollWidth: number;
  regions: Partial<Record<string, Region>>;
  tabsTop: number | null;
};

export async function measure(page: Page): Promise<PageMetrics> {
  await settle(page);
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      const top = Math.round(r.top + window.scrollY);
      return { top, height: Math.round(r.height), bottom: top + Math.round(r.height) };
    };
    const regions: Record<string, { top: number; height: number; bottom: number }> = {};
    for (const el of Array.from(document.querySelectorAll("[data-region]"))) {
      const name = el.getAttribute("data-region");
      if (name) regions[name] = box(el);
    }
    const tabs = document.querySelector('[role="tablist"]');
    return {
      docHeight: Math.round(document.documentElement.scrollHeight),
      docWidth: Math.round(document.documentElement.clientWidth),
      scrollWidth: Math.round(document.documentElement.scrollWidth),
      regions,
      tabsTop: tabs ? box(tabs).top : null,
    };
  });
}

/** Console and page errors are release failures, not warnings: the overview's
 * hydration mismatch was invisible in screenshots and only showed in the log. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const url = r.url();
    // Only same-origin: a blocked third-party request is not our defect.
    const sameOrigin = url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost");
    if (!sameOrigin) return;
    // Next cancels in-flight RSC prefetches when the router moves on. An
    // aborted prefetch is the framework working, not a broken request.
    const abortedPrefetch = url.includes("_rsc=") && r.failure()?.errorText === "net::ERR_ABORTED";
    if (abortedPrefetch) return;
    errors.push(`requestfailed: ${url} ${r.failure()?.errorText ?? ""}`);
  });
  return errors;
}

export function expectNoErrors(errors: string[], label: string) {
  // Hydration mismatches surface as console errors; React never throws them.
  expect(errors, `${label} produced browser errors`).toEqual([]);
}

export function expectNoHorizontalOverflow(m: PageMetrics, label: string) {
  expect(
    m.scrollWidth,
    `${label} overflows horizontally: scrollWidth ${m.scrollWidth} > clientWidth ${m.docWidth}`,
  ).toBeLessThanOrEqual(m.docWidth + 1);
}

/** Phase 1 gates for the transaction page, in CSS pixels at 390x844.
 * Recorded 2026-07-31 before the journey redesign:
 *   journey region 598, tabs top 1143, settlement bottom 952.
 * The gates below are the targets, so they fail until the redesign lands. */
export const TX_GATES = {
  journeyMaxHeight: 160,
  /** The answer to "where is it and is it final" must be readable without
   * scrolling on a 390x844 phone. */
  answerMaxBottom: 560,
  tabsMaxTop: 700,
} as const;

export function reportTxLayout(m: PageMetrics, label: string): string {
  const j = m.regions.journey;
  return [
    `${label}:`,
    `  identity   top=${m.regions.identity?.top ?? "-"} h=${m.regions.identity?.height ?? "-"}`,
    `  journey    top=${j?.top ?? "-"} h=${j?.height ?? "-"} bottom=${j?.bottom ?? "-"}`,
    `  tabs top   ${m.tabsTop ?? "-"}`,
    `  document   ${m.docHeight}`,
  ].join("\n");
}

/** Text painted below `floor`, in CSS pixels, wherever it came from.
 *
 * Lives here rather than in the spec because the spec's claim is only as good
 * as this walk, and a walk that cannot be exercised on its own gets trusted
 * without ever being checked. Given a page, it returns one line per distinct
 * (size, element shape) pair.
 *
 * Three filters, each load-bearing:
 *   - `checkVisibility` keeps out the responsive branch that is not painted.
 *     The desktop table still carries its classes at 390px, and reporting its
 *     headers there would be a finding about markup, not about what is read.
 *   - `exempt` drops text the floor does not govern: `<sup>`/`<sub>` are shrunk
 *     by the UA relative to their container, so holding them to it would mean
 *     setting them larger than body.
 *   - the dedup key is (size, tag+class), so an 11px table header reports once
 *     rather than once per column and buries everything else. */
export async function undersizedText(page: Page, floor: number, exempt: string[]) {
  await settle(page);
  return page.evaluate(
    ({ floor, exempt }) => {
      const found: string[] = [];
      const seen = new Set<string>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || exempt.includes(el.tagName)) continue;
        const text = (node.textContent ?? "").trim();
        if (!text) continue;
        if (!el.checkVisibility()) continue;

        const size = parseFloat(getComputedStyle(el).fontSize);
        if (!(size < floor)) continue;

        const where = `${el.tagName.toLowerCase()}.${el.className || "-"}`.slice(0, 90);
        const key = `${size}|${where}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(`${size}px  ${where}  "${text.slice(0, 40)}"`);
      }
      return found;
    },
    { floor, exempt },
  );
}
