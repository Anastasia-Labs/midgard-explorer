/**
 * Production dependency audit, gated on recorded dispositions.
 *
 * `pnpm audit` on its own either fails the build on an advisory nobody has
 * looked at yet, or is left out of CI entirely and the report is never read.
 * This fails only on advisories that have no recorded disposition, so a new one
 * stops the build and a triaged one does not.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const accepted = new Map(
  JSON.parse(readFileSync(join(root, "security-advisories.json"), "utf8")).accepted.map(
    (entry) => [entry.id, entry],
  ),
);

let report;
try {
  report = execFileSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch (err) {
  // pnpm exits non-zero when it finds anything; the report is still on stdout.
  report = err.stdout ?? "";
}

const advisories = Object.values(JSON.parse(report || "{}").advisories ?? {});
const unrecorded = advisories.filter((a) => !accepted.has(a.github_advisory_id ?? a.url?.split("/").pop()));

for (const a of advisories) {
  const id = a.github_advisory_id ?? a.url?.split("/").pop();
  const mark = accepted.has(id) ? "recorded" : "UNRECORDED";
  console.log(`${mark}  ${a.severity}  ${a.module_name}  ${id}`);
}

if (unrecorded.length > 0) {
  console.error(
    `\n${unrecorded.length} advisory/advisories have no recorded disposition. ` +
      `Triage each one and add it to security-advisories.json.`,
  );
  process.exit(1);
}
console.log(`\n${advisories.length} advisory/advisories, all with a recorded disposition.`);
