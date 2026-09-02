#!/usr/bin/env node
/**
 * `dev doctor`: what is wrong, and the command that fixes it.
 *
 * Read-only. It runs the checks in checks.mjs for one mode and reports each by
 * a stable id, so a failure can be referred to, tested and searched for without
 * quoting a sentence that may be reworded later.
 *
 * Exit codes:
 *   0  no check failed
 *   1  at least one check failed, or one could not be run
 *   2  the command was used wrongly
 *
 * Usage: doctor.mjs <repoRoot> [demo|existing|full] [--json] [--with-l1-sync]
 */
import { pathToFileURL } from "node:url";

import { CHECKS } from "./lib/checks.mjs";
import { redact } from "./lib/env.mjs";

const MODES = ["demo", "existing", "full"];

/* Modes ADR 3 records as a procedure rather than a command. Their checks still
 * run: knowing this machine could host the mode is what the report is for. The
 * banner says there is nothing to start, so a page of PASS lines is not read as
 * "starting it will work". */
const UNBUILT = new Set(["full"]);

/** Runs a set of checks and classifies each outcome.
 *
 * Exported so the runner can be tested with a check that misbehaves. The one
 * case that matters is a check that throws: it used to be reported as `skip`,
 * and skips do not set the exit code, so a doctor run with a broken check
 * printed "Ready" while the check that would have said otherwise never ran.
 */
export const runChecks = async (ctx, checks) => {
  const results = [];
  for (const check of checks) {
    let outcome;
    try {
      outcome = await check.run(ctx);
    } catch (error) {
      // A defect in the check, not a verdict on the machine, and still an
      // answer doctor does not have.
      outcome = {
        status: "error",
        detail: `the check itself failed: ${String(error?.message ?? error)}`,
        hint: "This is a defect in the check, not in the machine. Doctor cannot answer for this mode until it is fixed",
      };
    }
    results.push({
      id: check.id,
      title: check.title,
      status: outcome.status,
      // Redacted once here as well as at the source. Every path into a detail
      // string is a path a password could take into a terminal or an issue.
      detail: redact(outcome.detail ?? ""),
      hint: outcome.hint === undefined ? null : redact(outcome.hint),
    });
  }
  return results;
};

/** Counts by status, and whether the run may call itself ready.
 *
 * An unanswered check is not a pass: "Ready" claims every check ran, so one
 * that could not run withholds it. */
export const summarise = (results) => {
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 };
  for (const result of results) summary[result.status] += 1;
  return { summary, failed: summary.fail > 0 || summary.error > 0 };
};

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (!isEntryPoint) {
  // Imported for the runner above. Nothing to run.
} else {

const args = process.argv.slice(2);
const repoRoot = args.shift();
const json = args.includes("--json");
// The same flag `up existing` takes, so the question asked here is the one the
// mode was started with rather than the one backend/.env describes.
const withL1Sync = args.includes("--with-l1-sync");
const mode = args.find((a) => !a.startsWith("-")) ?? "demo";

if (repoRoot === undefined) {
  process.stderr.write("doctor.mjs needs the repository root\n");
  process.exit(2);
}
if (!MODES.includes(mode)) {
  process.stderr.write(`Unknown mode: ${mode}\n  Use one of: ${MODES.join(", ")}\n`);
  process.exit(2);
}

const ctx = { repoRoot, mode, withL1Sync };
const selected = CHECKS.filter((check) => check.modes.includes(mode));

const results = await runChecks(ctx, selected);
const { summary, failed } = summarise(results);

if (json) {
  process.stdout.write(
    `${JSON.stringify(
      { mode, modeBuilt: !UNBUILT.has(mode), ok: !failed, summary, checks: results },
      null,
      2,
    )}\n`,
  );
} else {
  const colour = process.stdout.isTTY;
  const paint = (code, text) => (colour ? `\u001b[${code}m${text}\u001b[0m` : text);
  const label = {
    pass: paint(32, "PASS"),
    warn: paint(33, "WARN"),
    fail: paint(31, "FAIL"),
    skip: paint(90, "SKIP"),
    error: paint(31, "ERROR"),
  };

  process.stdout.write(`\n${paint(1, `Doctor: ${mode} mode`)}\n`);
  if (UNBUILT.has(mode)) {
    process.stdout.write(
      `\`${mode}\` is a documented procedure rather than a command: it needs\n` +
        `services this repository does not provision, and does not check. These\n` +
        `checks cover the explorer's own requirements only.\n` +
        `Follow docs/running-full-midgard.md.\n`,
    );
  }
  process.stdout.write("\n");

  const width = Math.max(...results.map((r) => r.id.length));
  for (const result of results) {
    process.stdout.write(`${label[result.status]}  ${result.id.padEnd(width)}  ${result.detail}\n`);
    if (result.hint) process.stdout.write(`      ${" ".repeat(width)}  hint: ${result.hint}\n`);
  }

  process.stdout.write(
    `\n${summary.pass} passed, ${summary.warn} warned, ${summary.fail} failed, ` +
      `${summary.skip} skipped` +
      (summary.error > 0 ? `, ${summary.error} could not be run` : "") +
      "\n",
  );
  if (summary.error > 0) {
    process.stdout.write(
      `\n${summary.error} check(s) could not be run, so this report is incomplete.\n`,
    );
  }
  if (failed) {
    // The flag is repeated back. Dropping it would send the reader to a run
    // that asks the narrower question, and answers Ready to the wider one.
    const again = `pnpm doctor${mode === "existing" ? "" : ` ${mode}`}${
      withL1Sync ? " --with-l1-sync" : ""
    }`;
    process.stdout.write(`\nFix the failures above, then run: ${again}\n`);
  } else if (!UNBUILT.has(mode)) {
    process.stdout.write(
      `\nReady. Start it with: ${mode === "demo" ? "cd frontend-new && pnpm dev:demo" : "pnpm dev"}\n`,
    );
  } else {
    process.stdout.write(
      `\nThe explorer's own requirements are met. Follow docs/running-full-midgard.md\n`,
    );
  }
}

process.exit(failed ? 1 : 0);

}
