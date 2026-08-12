#!/usr/bin/env node
/** The cold-browser reliability gate for the dynamically imported canvas.
 *
 * Why this exists as a separate script rather than as more tests: the canvas
 * arrives as a separately fetched chunk, and only the FIRST load of that chunk
 * in a given browser profile is cold. Running the same test three times in one
 * profile measures one cold load and two warm ones, which is how a flake
 * survives a rerun and gets called cleared. Two crossed flakes on 2026-08-11
 * were exactly that, one on desktop and one on mobile.
 *
 * Conditions, using the vocabulary agreed on 2026-08-11:
 *   - cold browser: new process, new profile, empty HTTP cache. Every iteration.
 *   - cold application: the production server is stopped and restarted between
 *     iterations, so nothing in its memory carries over. Every iteration.
 *   - cold build: ONCE, at the start. Rebuilding per iteration would conflate
 *     build reliability with chunk-loading reliability and costs three minutes
 *     an iteration on this hardware for no added signal.
 *
 * How the cold browser is actually obtained, since a previous version of this
 * script claimed it with an environment variable Playwright does not read:
 * every iteration spawns a new `playwright test` process, which launches a new
 * Chromium with a fresh temporary user data directory, and every test inside it
 * gets its own browser context. There is no profile and no HTTP cache to carry
 * a warm chunk from one iteration to the next. Nothing needs wiring; what it
 * needed was saying out loud, because an invented variable read as a mechanism
 * while providing none.
 *
 * This is slow by construction, which is why it does not belong in the default
 * suite: an eight minute gate people run is worth more than a forty minute gate
 * they skip.
 *
 * Usage:
 *   pnpm test:canvas-reliability            # 20 iterations
 *   ITERATIONS=5 pnpm test:canvas-reliability
 *   SKIP_BUILD=1 pnpm test:canvas-reliability
 */

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";

const ITERATIONS = Number(process.env.ITERATIONS ?? 20);
const PORT = Number(process.env.E2E_PORT ?? 3210);
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3211);
const GREP = "readiness state|canvas controls";

/** Below this, a failure is at least as likely to be the box as the product.
 * The first run of this gate leaked four servers until 444MB remained, and
 * reported the canvas unreliable. Memory is recorded so that verdict can never
 * be reached again without the evidence to check it against. */
const MEMORY_PRESSURE_MB = 1024;

const serverEnv = {
  NEXT_PUBLIC_API_BASE: `http://127.0.0.1:${FIXTURE_PORT}`,
  NEXT_PUBLIC_NETWORK_LABEL: "Fixture",
  NEXT_PUBLIC_L1_EXPLORER_TX_URL: "https://preprod.cardanoscan.io/transaction/{hash}",
  NEXT_PUBLIC_L1_EXPLORER_NAME: "Cardanoscan",
};

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });
}

function background(command, args, env = {}) {
  return spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
}

async function waitFor(url, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (await predicate(res)) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ---------------------------------------------------------------- resources */

/** Available memory and load, sampled around each iteration.
 *
 * A gate that cannot tell "the canvas is unreliable" from "the machine had
 * 400MB left" produces a verdict nobody should act on. */
async function resources() {
  let availableMb = null;
  try {
    const meminfo = await readFile("/proc/meminfo", "utf8");
    const kb = /MemAvailable:\s+(\d+) kB/.exec(meminfo)?.[1];
    if (kb !== undefined) availableMb = Math.round(Number(kb) / 1024);
  } catch {
    /* not Linux; the gate still runs, it just reports less */
  }
  let load = null;
  try {
    load = Number((await readFile("/proc/loadavg", "utf8")).split(" ")[0]);
  } catch {
    /* as above */
  }
  return { availableMb, load };
}

/* ------------------------------------------------------------ port ownership */

/** PIDs listening on a port. `sport = :N` is an exact match, unlike grepping
 * for `:3210`, which also matches 32100. */
async function listenersOn(port) {
  const { output } = await run("bash", [
    "-lc",
    `ss -ltnpH 'sport = :${port}' 2>/dev/null || true`,
  ]);
  return [...new Set([...output.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))];
}

/** Every process descended from `root`, including it, read from /proc.
 *
 * This is the set the gate is allowed to signal. A PID outside it belongs to
 * somebody else: a dev server, a container, another project's suite. Killing
 * whatever holds a port is how a test harness designed to avoid adopting a
 * foreign service ends up destroying one instead. */
async function processTree(root) {
  const parentOf = new Map();
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = await readFile(`/proc/${entry}/stat`, "utf8");
      // `comm` may contain spaces and parentheses, so fields are counted from
      // the last ')' rather than by splitting the whole line.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      parentOf.set(Number(entry), Number(fields[1]));
    } catch {
      /* exited between readdir and read */
    }
  }
  const tree = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of parentOf) {
      if (!tree.has(pid) && tree.has(ppid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  return tree;
}

async function portFreeWithin(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await listenersOn(port)).length === 0) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return (await listenersOn(port)).length === 0;
}

/** Refuse to start on an occupied port rather than clearing it.
 *
 * The gate's whole premise is that it knows what it is testing. A port it did
 * not open may hold a dev server someone is using, and adopting it silently is
 * the failure mode that produced twelve fake failures on 2026-08-11. Stopping
 * is the only honest option: the alternative is destroying somebody's work to
 * make room for a test. */
async function requireFreePort(port, label) {
  const holders = await listenersOn(port);
  if (holders.length === 0) return;
  console.log(`Port ${port} (${label}) is already in use by pid ${holders.join(", ")}.`);
  console.log("This gate does not adopt or kill processes it did not start.");
  console.log(`Free the port, or rerun with a different one: E2E_PORT / FIXTURE_PORT.`);
  process.exit(1);
}

/** Stop a server this gate started: politely, then firmly, and only ever
 * against its own descendants. */
async function stopOwned(child, port, label) {
  if (child === null || child === undefined) return;
  const owned = await processTree(child.pid);

  for (const pid of owned) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  if (await portFreeWithin(port, 5_000)) return;

  // `pnpm start` becomes `sh -c next start` becomes `next-server`, and the last
  // of those has ignored a group signal before. Escalate, still only within the
  // tree this gate created.
  for (const pid of owned) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  if (await portFreeWithin(port, 5_000)) return;

  const strangers = (await listenersOn(port)).filter((pid) => !owned.has(pid));
  console.log(
    `Port ${port} (${label}) is still held after signalling every process this gate started` +
      (strangers.length > 0 ? `; pid ${strangers.join(", ")} is not one of them.` : "."),
  );
  process.exit(1);
}

/* ------------------------------------------------------------------- the gate */

await requireFreePort(FIXTURE_PORT, "fixture");
await requireFreePort(PORT, "application");

if (process.env.SKIP_BUILD !== "1") {
  console.log("Building once. Per-iteration rebuilds would measure the build, not the chunk.");
  const build = await run("pnpm", ["build"], serverEnv);
  if (build.code !== 0) {
    console.log(build.output.split("\n").slice(-20).join("\n"));
    process.exit(1);
  }
}

const fixture = background("node", ["e2e/fixtures/server.mjs"], {
  FIXTURE_PORT: String(FIXTURE_PORT),
});
const fixtureUp = await waitFor(
  `http://127.0.0.1:${FIXTURE_PORT}/__control`,
  async (res) => (await res.json()).fixture === "midgard-explorer-e2e",
  30_000,
);
if (!fixtureUp) {
  console.log(`The fixture did not come up on ${FIXTURE_PORT}.`);
  await stopOwned(fixture, FIXTURE_PORT, "fixture");
  process.exit(1);
}

const results = [];
for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
  const before = await resources();
  const server = background("pnpm", ["start", "--port", String(PORT)], serverEnv);
  const appUp = await waitFor(
    `http://127.0.0.1:${PORT}/api/health`,
    async (res) => typeof (await res.json()).up === "boolean",
    60_000,
  );
  if (!appUp) {
    results.push({ iteration, passed: false, seconds: "0.0", ...before });
    console.log(`iteration ${iteration}/${ITERATIONS}: FAIL (application never came up)`);
    await stopOwned(server, PORT, "application");
    continue;
  }

  const started = Date.now();
  const { code, output } = await run(
    "pnpm",
    ["exec", "playwright", "test", "e2e/utxo-flow.spec.ts", "-g", GREP],
    {
      E2E_PORT: String(PORT),
      FIXTURE_PORT: String(FIXTURE_PORT),
      // This script started the server itself, so adopting it is not a guess.
      E2E_REUSE_SERVER: "1",
    },
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const passed = code === 0;
  const during = await resources();
  const availableMb =
    before.availableMb === null || during.availableMb === null
      ? null
      : Math.min(before.availableMb, during.availableMb);

  results.push({ iteration, passed, seconds, availableMb, load: during.load });
  const pressure = availableMb !== null && availableMb < MEMORY_PRESSURE_MB ? " UNDER PRESSURE" : "";
  console.log(
    `iteration ${iteration}/${ITERATIONS}: ${passed ? "pass" : "FAIL"} (${seconds}s, ` +
      `${availableMb ?? "?"}MB free, load ${during.load ?? "?"})${pressure}`,
  );
  if (!passed) console.log(output.split("\n").slice(-30).join("\n"));

  await stopOwned(server, PORT, "application");
}

await stopOwned(fixture, FIXTURE_PORT, "fixture");

const passes = results.filter((r) => r.passed).length;
const memories = results.map((r) => r.availableMb).filter((m) => m !== null);
const loads = results.map((r) => r.load).filter((l) => l !== null);

console.log(`\n${passes}/${ITERATIONS} cold-browser, cold-application iterations passed.`);
if (memories.length > 0) {
  console.log(
    `Memory available: ${Math.min(...memories)}MB at the tightest, ` +
      `${Math.max(...memories)}MB at the loosest. Peak load ${Math.max(...loads).toFixed(2)}.`,
  );
}

const starved = results.filter(
  (r) => !r.passed && r.availableMb !== null && r.availableMb < MEMORY_PRESSURE_MB,
);
if (starved.length > 0) {
  console.log(
    `\n${starved.length} failure(s) happened with under ${MEMORY_PRESSURE_MB}MB free ` +
      `(iteration ${starved.map((r) => r.iteration).join(", ")}). Classify those as machine, ` +
      `not product, and rerun on a box that is not starving. The gate is not clean either way.`,
  );
}

if (passes !== ITERATIONS) {
  console.log("The canvas readiness path is not reliable. Do not accept the gate.");
  process.exit(1);
}
