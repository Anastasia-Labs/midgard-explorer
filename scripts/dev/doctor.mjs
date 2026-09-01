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
 *   1  at least one check failed
 *   2  the command was used wrongly
 *
 * Usage: doctor.mjs <repoRoot> [demo|existing|full] [--json]
 */
import { CHECKS } from "./checks.mjs";
import { redact } from "./env.mjs";

const MODES = ["demo", "existing", "full"];

/* Modes ADR 3 records but no PR has built. Their checks still run: knowing the
 * environment is ready is useful before the mode exists. The banner says the
 * mode cannot be started, so a page of PASS lines is not read as "it works". */
const UNBUILT = new Set(["full"]);

const args = process.argv.slice(2);
const repoRoot = args.shift();
const json = args.includes("--json");
const mode = args.find((a) => !a.startsWith("-")) ?? "demo";

if (repoRoot === undefined) {
  process.stderr.write("doctor.mjs needs the repository root\n");
  process.exit(2);
}
if (!MODES.includes(mode)) {
  process.stderr.write(`Unknown mode: ${mode}\n  Use one of: ${MODES.join(", ")}\n`);
  process.exit(2);
}

const ctx = { repoRoot, mode };
const selected = CHECKS.filter((check) => check.modes.includes(mode));

const results = [];
for (const check of selected) {
  let outcome;
  try {
    outcome = await check.run(ctx);
  } catch (error) {
    // A check that throws is a defect in the check, not a verdict on the
    // machine. Reporting it as `skip` keeps one broken check from failing a
    // doctor run that is otherwise informative.
    outcome = {
      status: "skip",
      detail: `the check itself failed: ${String(error?.message ?? error)}`,
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

const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
for (const result of results) summary[result.status] += 1;
const failed = summary.fail > 0;

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
  };

  process.stdout.write(`\n${paint(1, `Doctor: ${mode} mode`)}\n`);
  if (UNBUILT.has(mode)) {
    process.stdout.write(
      `\`./dev up ${mode}\` does not exist yet. These checks report whether the\n` +
        `environment that mode will need is ready. Modes are recorded in\n` +
        `docs/decisions/0003-three-development-modes.md.\n`,
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
      `${summary.skip} skipped\n`,
  );
  if (failed) {
    process.stdout.write(`\nFix the failures above, then run: ./dev doctor ${mode}\n`);
  } else if (!UNBUILT.has(mode)) {
    process.stdout.write(`\nReady. Start it with: ./dev up ${mode}\n`);
  }
}

process.exit(failed ? 1 : 0);
