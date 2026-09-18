#!/usr/bin/env node
/**
 * Checks the two claims documentation makes that can be checked.
 *
 * A link that resolves, and a command that exists. Both rot the same way: the
 * file is renamed or the script is dropped, and the page keeps saying what used
 * to be true. Prose cannot be checked this way and is not attempted here.
 *
 * Usage: docs-check.mjs <repoRoot>
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = process.argv[2];
if (!repoRoot) {
  process.stderr.write("docs-check.mjs needs the repository root\n");
  process.exit(2);
}

/**
 * Every file git tracks, and every directory holding one.
 *
 * The link check used to ask the filesystem whether a target existed, which
 * answers a question about this machine rather than about the repository. A
 * page linking to a plan under `docs/superpowers/`, or to a local evidence
 * directory, passed here and was dead for everyone who cloned it.
 */
const trackedPaths = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);
const tracked = new Set(trackedPaths);
const trackedDirectories = new Set(
  trackedPaths.flatMap((file) => {
    const parts = file.split("/").slice(0, -1);
    return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  }),
);

/** A path inside the repository, in the form `git ls-files` prints. */
const relativeToRepo = (absolute) => relative(repoRoot, absolute).split("\\").join("/");

/** Markdown that is meant to be read, which is not every markdown file: the
 * design briefs and redesign notes are working papers, kept but not maintained
 * as pages. */
const PAGES = [
  "README.md",
  "backend/README.md",
  "frontend-new/README.md",
  "docs/running-demo.md",
  "docs/running-existing-midgard.md",
  "docs/running-full-midgard.md",
  "docs/troubleshooting.md",
  // Every top-level page under docs/, scanned as a directory. Listing them by
  // hand left `docs/performance-budgets.md` outside the gate entirely: the
  // register that governs the performance programme was never checked for a
  // link or a command, and carried thirteen verification commands naming a
  // flag that never existed.
  ...readdirSync(join(repoRoot, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`),
  // Release records carry operational commands an operator runs during a
  // rollout, which is the worst possible place for a command that no longer
  // exists. Scanned as a directory so a new record is gated the day it lands
  // rather than the day someone remembers to list it.
  ...readdirSync(join(repoRoot, "docs", "release"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/release/${name}`),
  ...readdirSync(join(repoRoot, "docs", "decisions"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/decisions/${name}`),
];

/** Which package a page's bare `pnpm x` belongs to, by the directory the page
 * tells the reader to be in.
 *
 * A page not listed here has no default directory, so only its explicit
 * `cd <package> && pnpm x` lines are checked. Leaving those unchecked let a
 * stale `npx ts-node scripts/probe-readiness.ts` sit in the root README. */
const PACKAGE_OF = {
  "backend/README.md": "backend",
  "frontend-new/README.md": "frontend-new",
};

/** The packages a page may send a reader into. */
const PACKAGES = ["backend", "frontend-new"];

const problems = [];

const scriptsOf = (packageDir) => {
  const manifest = join(repoRoot, packageDir, "package.json");
  if (!existsSync(manifest)) return null;
  return new Set(Object.keys(JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {}));
};

for (const page of PAGES) {
  const path = join(repoRoot, page);
  if (!existsSync(path)) {
    problems.push(`${page} does not exist, but is listed as a page`);
    continue;
  }
  const text = readFileSync(path, "utf8");

  // Links to something in this repository. External URLs and in-page anchors
  // are somebody else's to keep working.
  //
  // Resolved against TRACKED files, not against the working tree. A page that
  // links into a git-excluded path (a plan, a local evidence directory, a
  // build output) passes on the machine that has it and is a dead link in a
  // fresh clone, which is the only place a reader ever follows it.
  for (const [, label, target] of text.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [file] = target.split("#");
    if (file === "") continue;
    const resolved = resolve(dirname(path), file);
    const relative = relativeToRepo(resolved);
    if (!existsSync(resolved)) {
      problems.push(`${page}: "${label}" points at ${file}, which does not exist`);
      continue;
    }
    const isDirectory = statSync(resolved).isDirectory();
    if (!isDirectory && !tracked.has(relative)) {
      problems.push(
        `${page}: "${label}" points at ${file}, which exists here but is not tracked, ` +
          `so it is a dead link in a fresh clone`,
      );
      continue;
    }
    if (isDirectory && !trackedDirectories.has(relative)) {
      problems.push(
        `${page}: "${label}" points at ${file}, a directory holding no tracked file`,
      );
      continue;
    }
    if (isDirectory && !file.endsWith("/")) {
      problems.push(`${page}: "${label}" points at a directory without a trailing slash`);
    }
  }

  // Commands, read as a reader reads them: a fenced block is a sequence, so a
  // `cd` on its own line decides which package the lines after it run in.
  // Matching only `cd X && pnpm y` left the quick start, which is the most
  // read set of commands in the repository, entirely unchecked.
  const PNPM_OWN = ["install", "exec", "dlx", "add", "why", "store"];
  const check = (packageDir, script, line) => {
    if (packageDir === undefined) return;
    if (PNPM_OWN.includes(script)) return;
    const scripts = scriptsOf(packageDir);
    if (scripts === null) {
      problems.push(`${page}: ${packageDir}/package.json does not exist`);
      return;
    }
    if (!scripts.has(script)) {
      problems.push(
        `${page}: "${line}" runs \`pnpm ${script}\` in ${packageDir}, which does not define it`,
      );
    }
  };

  const readCommands = (lines, startingIn) => {
    let where = startingIn;
    for (const raw of lines) {
      const line = raw.trim().replace(/\s+#.*$/, "");
      if (line === "") continue;

      // A command run through npm or npx is not a package script, so nothing
      // checks it and it rots silently.
      const stale = line.match(/\b(npx|npm run)\s+([a-z@][\w@/.:-]*)/);
      if (stale) {
        problems.push(
          `${page}: "${line}" uses \`${stale[1]}\`; a documented command should be a package script`,
        );
      }

      // The repository root once carried a `./dev` command that started every
      // service. It was removed in favour of the two package commands, so a
      // page naming it sends a reader to a file that is not there.
      //
      // A decision record is exempt, because recording what a decision replaced
      // is what a decision record is for. Every other page tells a reader what
      // to run.
      if (!page.startsWith("docs/decisions/") && /(^|\s)\.\/dev(\s|$)/.test(line)) {
        problems.push(`${page}: "${line}" names ./dev, which no longer exists`);
      }

      for (const segment of line.split("&&")) {
        const step = segment.trim();
        const cd = step.match(/^cd\s+(?:\.\.\/)*([a-z0-9-]+)\/?$/);
        if (cd) {
          where = PACKAGES.includes(cd[1]) ? cd[1] : undefined;
          continue;
        }
        if (/^cd\s+\.\.\/?$/.test(step)) {
          where = undefined;
          continue;
        }
        const pnpm = step.match(/^pnpm\s+(?:--silent\s+)?(?:run\s+)?([a-z][a-z0-9:.-]*)/);
        if (pnpm) check(where, pnpm[1], line);
      }
    }
  };

  // Fenced blocks are sequences; inline code is a single command, which runs
  // wherever the page says its commands run.
  for (const [, block] of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    readCommands(block.split("\n"), PACKAGE_OF[page]);
  }
  for (const [, inline] of text.matchAll(/`([^`\n]+)`/g)) {
    readCommands([inline], PACKAGE_OF[page]);
  }
}

/**
 * A documented script invocation must name a script that exists.
 *
 * The gate only ever checked `pnpm <script>`, so a bare path in a table cell
 * went unread. `docs/performance-budgets.md` named
 * `bench/harness.mts --workload <name>` as the verification command for
 * thirteen rows, and neither that entry point nor that flag existed, while the
 * gate reported that every documented command exists.
 *
 * Only invocations are checked: a script path FOLLOWED BY ARGUMENTS. A bare
 * `db.ts` or `route.ts` in prose is a reference to source, not a command, and
 * flagging those made the gate fail on correct documentation.
 */
const INVOCATION = /^([a-zA-Z0-9_@./-]+\.(?:mjs|mts|ts|sh|js))\s+\S/;
const SCRIPT_DIRS = [
  "",
  "backend/",
  "backend/scripts/",
  "frontend-new/",
  "frontend-new/app/",
  "frontend-new/app/scripts/",
  "scripts/",
];

/* A release record marked superseded may name a command that has since been
 * removed. Recording what was run, and what it produced, is the whole purpose
 * of the record, and rewriting it to name something else would make it a
 * different claim about history. The marker is what earns the exemption: an
 * unmarked record still tells a reader what to run, and is still checked. */
const isSupersededRecord = (page, text) =>
  page.startsWith("docs/release/") && /^>\s*\*\*Superseded/m.test(text);

for (const page of PAGES) {
  const text = readFileSync(join(repoRoot, page), "utf8");
  if (isSupersededRecord(page, text)) continue;
  for (const [, inline] of text.matchAll(/`([^`\n]+)`/g)) {
    const match = INVOCATION.exec(inline.trim());
    if (!match) continue;
    const target = match[1];
    const found = SCRIPT_DIRS.some((dir) => existsSync(join(repoRoot, dir + target)));
    if (!found) {
      problems.push(`${page}: "${inline}" runs ${target}, which does not exist`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.length} documentation problem(s):\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `${PAGES.length} pages: every repository link resolves and every documented command exists\n`,
);
