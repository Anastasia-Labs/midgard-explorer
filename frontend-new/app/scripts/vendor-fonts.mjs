/**
 * Refreshes the vendored web fonts.
 *
 * `next/font/google` downloads each family during `next build`, so the
 * production build required network access: CI could not build, and the e2e
 * gate could not run because it builds first. The families are vendored
 * instead, and this script is how they are updated.
 *
 * It takes the basic-latin block specifically. Google's stylesheet carries
 * several `@font-face` blocks with different `unicode-range`s, and the first
 * one holds roughly the alphabet alone: 52 glyphs, no digits and no
 * punctuation. A hash column rendered in a fallback face is the symptom.
 *
 *   node scripts/vendor-fonts.mjs
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const FAMILIES = [
  { family: "Geist", file: "geist-sans", weight: "100..900" },
  { family: "Geist+Mono", file: "geist-mono", weight: "100..900" },
  { family: "Platypi", file: "platypi", weight: "300..800" },
];

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "fonts");

for (const { family, file, weight } of FAMILIES) {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`,
    { headers: { "user-agent": UA } },
  ).then((r) => r.text());

  const blocks = [...css.matchAll(/@font-face\s*\{(.*?)\}/gs)].map((m) => m[1]);
  const latin = blocks.find((b) => /unicode-range:[^;]*U\+0000/.test(b));
  const chosen = latin ?? blocks.at(-1);
  const url = chosen?.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+\.woff2)\)/)?.[1];
  if (!url) throw new Error(`No woff2 URL for ${family}`);

  const bytes = Buffer.from(await (await fetch(url, { headers: { "user-agent": UA } })).arrayBuffer());
  if (bytes.subarray(0, 4).toString() !== "wOF2") {
    throw new Error(`${family} did not return a woff2 file`);
  }
  await writeFile(join(outDir, `${file}.woff2`), bytes);
  console.log(`${file}.woff2  ${bytes.length} bytes`);
}
