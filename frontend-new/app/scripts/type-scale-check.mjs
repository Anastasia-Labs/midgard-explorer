#!/usr/bin/env node
/** A ratchet on arbitrary font sizes.
 *
 * The tree carries sixteen distinct hand-typed sizes across eighty-three call
 * sites, from `text-[10px]` to `text-[30px]`. None of that is a series of
 * mistakes; it is what happens when the theme names twenty colours and no
 * sizes, so `text-[11px]` is the only way to say "smaller than sm". The tokens
 * in `globals.css` fix the cause. This fixes the recurrence.
 *
 * Sweeping the eighty-three away is worth nothing on its own: nothing in
 * `eslint src e2e scripts` has an opinion about a Tailwind arbitrary value, so
 * the next badge is written `text-[11px]` next week and the audit runs again
 * next quarter. That is the actual failure mode being defended against here,
 * and it is why this lands before the sweep rather than after it.
 *
 * A ratchet, not a ban, so it can be wired into CI today rather than on the day
 * the sweep finishes. The count may only fall. Adding one fails; removing one
 * without lowering BASELINE also fails, because a baseline nobody lowers is a
 * budget, and a budget is how eighty-three of these accumulated.
 *
 * Usage:
 *   pnpm check:type-scale
 *   pnpm check:type-scale --list    # every occurrence, grouped by size
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/** Lower this, never raise it.
 *
 * 2, not 0. The two survivors are the network verdict headline in
 * `components/ui/metrics.tsx`, at 26/30. Tailwind has no step between 24 and
 * 30, and that headline is required by test to stay larger than the 24px
 * figures beneath it at every width, so the pair cannot be expressed in stock
 * steps without breaking something. The comment at the call site carries the
 * full reasoning. Sitting in the baseline is the honest place for it: an
 * allowlist would hide it, and 0-with-an-exception is a number that lies. */
const BASELINE = 2;

/** Sizes only. `text-[color:…]`, `text-balance` and the like are not what this
 * is about, and a rule that fires on them would be turned off. */
const ARBITRARY_SIZE = /text-\[[0-9]+(?:\.[0-9]+)?(?:px|rem|em)\]/g;

/** Comments are not call sites. Without this the gate counts the paragraph in
 * `globals.css` that explains why `text-[11px]` exists, which is both a false
 * positive and a perverse incentive: the only way to get the number down would
 * be to stop documenting the thing being removed. Blanked rather than deleted
 * so line numbers in the `--list` output still match the file. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(tsx?|css)$/.test(entry.name)) yield path;
  }
}

const hits = [];
for await (const path of walk(SRC)) {
  const text = stripComments(await readFile(path, "utf8"));
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(ARBITRARY_SIZE)) {
      hits.push({ file: relative(ROOT, path), line: i + 1, size: m[0] });
    }
  });
}

const bySize = new Map();
for (const h of hits) bySize.set(h.size, (bySize.get(h.size) ?? 0) + 1);
const ranked = [...bySize].sort((a, b) => b[1] - a[1]);

if (process.argv.includes("--list")) {
  for (const [size] of ranked) {
    console.log(`\n${size}`);
    for (const h of hits.filter((x) => x.size === size)) console.log(`  ${h.file}:${h.line}`);
  }
  console.log("");
}

const summary = ranked.map(([size, n]) => `${size}×${n}`).join("  ");
console.log(
  `${hits.length} arbitrary font sizes across ${new Set(hits.map((h) => h.file)).size} files`,
);
if (ranked.length) console.log(`  ${summary}`);

if (hits.length > BASELINE) {
  console.error(
    `\nFAIL: ${hits.length} arbitrary font sizes, baseline is ${BASELINE}.\n` +
      `Use a scale step instead: text-title / text-body / text-caption / text-micro,\n` +
      `or Tailwind's text-xs…text-3xl. Run with --list to see every occurrence.`,
  );
  process.exit(1);
}

if (hits.length < BASELINE) {
  console.error(
    `\nFAIL: down to ${hits.length} from a baseline of ${BASELINE}. Good.\n` +
      `Set BASELINE = ${hits.length} in scripts/type-scale-check.mjs so the\n` +
      `ground you just took cannot be given back.`,
  );
  process.exit(1);
}

if (hits.length === 0) {
  console.log("\nNo arbitrary font sizes. Turn this into a hard ban: BASELINE stays 0.");
}
