/**
 * Production dependency audit, gated on recorded dispositions.
 *
 * `pnpm audit` on its own either fails the build on an advisory nobody has
 * looked at yet, or is left out of CI entirely and the report is never read.
 * This fails only on advisories that have no recorded disposition, so a new one
 * stops the build and a triaged one does not.
 *
 * It fails CLOSED. Every way of not producing a report used to be read as "no
 * advisories": the catch below took `err.stdout ?? ""`, so removing `pnpm` from
 * PATH printed "0 advisories" and exited 0. A gate that reports success when it
 * did not run is worse than no gate, because it is believed. An audit that
 * cannot be produced, parsed, or recognised is an error now, and only a real
 * report with recorded dispositions passes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = (reason) => {
  console.error(`Dependency audit did not run: ${reason}`);
  process.exit(1);
};

const accepted = new Map(
  JSON.parse(
    readFileSync(join(root, "security-advisories.json"), "utf8"),
  ).accepted.map((entry) => [entry.id, entry]),
);

/**
 * `pnpm audit` exits non-zero when it FINDS something, which is not a failure
 * to run. The two are told apart by whether a process actually started and
 * exited: `err.status` is a number only when it did. Anything else (the binary
 * missing, a signal, a spawn error) means no audit happened.
 */
let report;
try {
  report = execFileSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  if (typeof err.status !== "number") {
    fail(`${err.code ?? err.message}. pnpm did not run.`);
  }
  report = err.stdout ?? "";
  if (report.trim() === "") {
    fail(
      `pnpm audit exited ${err.status} with no report on stdout. ` +
        `${(err.stderr ?? "").trim().slice(0, 400)}`,
    );
  }
}

let parsed;
try {
  parsed = JSON.parse(report);
} catch (err) {
  fail(`the report is not JSON (${err.message}).`);
}

// A report with no `advisories` key is not a clean report, it is a shape this
// gate does not recognise: a pnpm release that renamed the field would
// otherwise read as zero advisories forever.
if (parsed === null || typeof parsed !== "object" || !("advisories" in parsed)) {
  fail(
    `the report has no "advisories" field, so its shape is not recognised. ` +
      `Keys: ${Object.keys(parsed ?? {}).join(", ") || "(none)"}`,
  );
}

const advisories = Object.values(parsed.advisories ?? {});
const idOf = (a) => a.github_advisory_id ?? a.url?.split("/").pop();

for (const a of advisories) {
  const id = idOf(a);
  console.log(
    `${accepted.has(id) ? "recorded" : "UNRECORDED"}  ${a.severity}  ${a.module_name}  ${id}`,
  );
}

const unrecorded = advisories.filter((a) => !accepted.has(idOf(a)));
if (unrecorded.length > 0) {
  console.error(
    `\n${unrecorded.length} advisory/advisories have no recorded disposition. ` +
      `Triage each one and add it to security-advisories.json.`,
  );
  process.exit(1);
}
console.log(
  `\n${advisories.length} advisory/advisories, all with a recorded disposition.`,
);
