#!/usr/bin/env node
/** Console errors on a development server.
 *
 * Separate from the e2e suite and from the reliability gate on purpose: those
 * two run a production build, and React's hydration attribute comparison only
 * happens in development. A defect in that class is structurally invisible to
 * them. The nonce mismatch on the pre-paint theme script sat in the tree while
 * the production suite reported zero console errors on every route, because
 * production never performed the comparison that fails.
 *
 * This is a smoke gate, not a suite. It loads a handful of representative
 * routes on `next dev` and fails on any console error or page error. It is fast
 * enough to run before a commit and shallow enough that a failure is always
 * worth reading.
 *
 * Usage:
 *   pnpm check:dev-console
 *   DEV_PORT=3311 pnpm check:dev-console
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const PORT = Number(process.env.DEV_PORT ?? 3311);
const BASE = `http://127.0.0.1:${PORT}`;

/** One route per rendering shape, not one per page: the overview's client
 * queries, a server-rendered record page, the canvas behind a dynamic import,
 * and a list. Adding the remaining eighteen record pages would cost minutes and
 * exercise the same three code paths. */
const ROUTES = ["/", "/blocks", "/transactions", "/l1"];

const env = {
  ...process.env,
  PORT: String(PORT),
  NEXT_PUBLIC_NETWORK_LABEL: "Development",
  NEXT_PUBLIC_L1_EXPLORER_TX_URL: "https://preprod.cardanoscan.io/transaction/{hash}",
  NEXT_PUBLIC_L1_EXPLORER_NAME: "Cardanoscan",
};

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    child.on("close", (code) => resolve({ code, output }));
  });
}

/** The gate never adopts or clears a port it did not open, for the same reason
 * the reliability gate does not: the process there may be someone's work. */
const holders = await run("bash", ["-lc", `ss -ltnpH 'sport = :${PORT}' 2>/dev/null || true`]);
if (/pid=\d+/.test(holders.output)) {
  console.log(`Port ${PORT} is in use. Free it, or set DEV_PORT to something else.`);
  process.exit(1);
}

/** Next allows one development server per project directory and records the
 * owner in `.next/dev/lock`. A second `next dev` still starts, still serves
 * pages, and still answers 200, but it does not own hot reload and it does not
 * report hydration mismatches.
 *
 * That is a false clean, which is worse than no gate: this script found the
 * nonce defect when run against the owning server and reported four clean
 * routes when run beside one. Refusing to start is the only safe answer, and
 * the lock is checked again after startup because the owner can change between
 * the two moments. */
const LOCK = ".next/dev/lock";

async function lockOwner() {
  try {
    const { pid, port } = JSON.parse(await readFile(LOCK, "utf8"));
    // A stale lock from a killed server names a pid that no longer exists.
    process.kill(pid, 0);
    return { pid, port };
  } catch {
    return null;
  }
}

const existingOwner = await lockOwner();
if (existingOwner !== null) {
  console.log(
    `Another development server (pid ${existingOwner.pid}, port ${existingOwner.port}) owns this` +
      ` project. A second one does not report hydration mismatches, so this gate would report a`,
  );
  console.log("false clean. Stop that server and rerun.");
  process.exit(1);
}

const dev = spawn("pnpm", ["dev"], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let devOutput = "";
let devExit = null;
dev.stdout.on("data", (c) => (devOutput += c));
dev.stderr.on("data", (c) => (devOutput += c));
dev.on("close", (code) => (devExit = code));

async function stopDev() {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

let up = false;
for (const deadline = Date.now() + 120_000; Date.now() < deadline; ) {
  // Next allows one development server per project directory, so the usual
  // reason this never comes up is another one already running. Reporting that
  // beats two minutes of silence followed by a timeout.
  if (devExit !== null) break;
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      up = true;
      break;
    }
  } catch {
    /* still compiling */
  }
  await new Promise((r) => setTimeout(r, 1_000));
}

if (!up) {
  console.log(
    devExit === null
      ? `The development server did not come up on ${PORT} within two minutes.`
      : `The development server exited with code ${devExit} before it was ready:`,
  );
  if (devExit !== null) console.log(devOutput.trim().split("\n").slice(-12).join("\n"));
  await stopDev();
  process.exit(1);
}

const owner = await lockOwner();
if (owner === null || owner.port !== PORT) {
  console.log(
    `This gate's server did not take the project lock (${LOCK} names ` +
      `${owner === null ? "nobody" : `port ${owner.port}`}). It would report a false clean.`,
  );
  await stopDev();
  process.exit(1);
}

const browser = await chromium.launch();
const failures = [];

/** The development server's own hot-reload socket, which Turbopack does not
 * serve at the webpack path the client still probes. It fails identically on
 * every route and says nothing about this application.
 *
 * This is the only exemption, and it is written as one narrow pattern rather
 * than a category, because a gate that filters by severity or by substring
 * eventually filters the defect it exists to catch. */
const DEV_SERVER_NOISE = /_next\/webpack-hmr/;

for (const route of ROUTES) {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !DEV_SERVER_NOISE.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  try {
    // `networkidle` rather than `load`: a hydration mismatch is reported after
    // React takes over, which is after the document has finished loading.
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(2_000);
  } catch (error) {
    errors.push(`navigation: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (errors.length === 0) {
    console.log(`${route}: clean`);
  } else {
    failures.push({ route, errors });
    console.log(`${route}: ${errors.length} error(s)`);
    for (const e of errors) console.log(`  ${e.slice(0, 400)}`);
  }
  await page.close();
}

await browser.close();
await stopDev();

if (failures.length > 0) {
  console.log(`\n${failures.length} of ${ROUTES.length} routes logged errors in development.`);
  process.exit(1);
}
console.log(`\nAll ${ROUTES.length} routes clean in development.`);
