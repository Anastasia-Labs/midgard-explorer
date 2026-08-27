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
import { dirname, join, resolve } from "node:path";

const here = fileURLToPath(import.meta.url);
const root = join(dirname(here), "..");

/** Importing this module must not run an audit. The suite imports the two
 * pure functions below; everything with an effect sits inside `main`, which
 * only runs when the file is executed directly. */
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === here;

const fail = (reason) => {
  console.error(`Dependency audit did not run: ${reason}`);
  process.exit(1);
};

/**
 * A date, not a date-SHAPED string.
 *
 * The regex on its own accepts 2026-99-99, which then compares as later than
 * any real date under a string comparison and never expires: the one input that
 * defeats the expiry is the one a typo produces. The value is parsed and read
 * back, so only a date the calendar actually has survives.
 */
export const parseExpiry = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  // Round-tripped, because Date rolls 2026-02-31 forward to March rather than
  // rejecting it.
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
};

/**
 * Dispositions are decisions with an end date.
 *
 * A recorded acceptance with no owner and no expiry is a permanent exemption:
 * it silences the advisory for as long as the file exists, and nothing ever
 * asks whether the reasoning still holds after the dependency has moved four
 * majors. Each entry carries a role that owns it and a date it stops counting.
 *
 * Both are checked when the file is READ, not when an advisory happens to
 * match, so an entry that has expired fails the build whether or not the
 * advisory is still reported. An advisory that is gone should have its record
 * deleted, and this is what says so.
 */
/** Exported so the suite exercises this function rather than a copy of it. */
export const checkDispositions = (entries, today = new Date()) => {
  const problems = [];
  for (const entry of entries) {
    if (typeof entry.owner !== "string" || entry.owner.trim() === "") {
      problems.push(`the disposition for ${entry.id} has no owner. Name the role that owns it.`);
      continue;
    }
    const expiry = parseExpiry(entry.expiresOn);
    if (expiry === null) {
      problems.push(
        `the disposition for ${entry.id} has no expiresOn date in YYYY-MM-DD form, got ` +
          `${JSON.stringify(entry.expiresOn ?? null)}. An acceptance without an end is a ` +
          `permanent exemption.`,
      );
      continue;
    }
    if (expiry.getTime() < today.getTime()) {
      problems.push(
        `the disposition for ${entry.id} (${entry.module}) expired on ` +
          `${entry.expiresOn} and is owned by ${entry.owner}. Re-triage it, ` +
          `extend it with a reason, or delete it if the advisory is gone.`,
      );
    }
  }
  return problems;
};

const loadDispositions = () => {
  const entries = JSON.parse(
    readFileSync(join(root, "security-advisories.json"), "utf8"),
  ).accepted;
  // Checked when the file is READ, not when an advisory happens to match, so an
  // expired entry fails whether or not the advisory is still reported.
  for (const problem of checkDispositions(entries)) fail(problem);
  return new Map(entries.map((entry) => [entry.id, entry]));
};

const accepted = loadDispositions();

const main = () => {
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
};

if (isMain) main();
