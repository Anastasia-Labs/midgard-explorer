#!/usr/bin/env node
/**
 * The explorer against committed fixture data.
 *
 * One command, one terminal, no backend, no Docker, no database and no
 * secrets. The fixture server answers the same routes as the real API, so the
 * whole interface can be developed and reviewed from a clean clone.
 *
 *   cd frontend-new && pnpm dev:demo
 *
 * The records shown are labelled as demo data, because an explorer full of
 * plausible transactions that describe nothing is worse than an empty one.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* Deliberately clear of the ports this stack already coordinates: 3101 (the
 * backend), 3102 (the API cache), and 3210 and 3211, which the end-to-end suite
 * owns and which must stay runnable while this is up. */
const PREFERRED = { app: 3010, fixture: 3110 };

const portFree = (port) =>
  new Promise((resolvePort) => {
    const probe = createServer();
    probe.once("error", () => resolvePort(false));
    probe.once("listening", () => probe.close(() => resolvePort(true)));
    probe.listen(port, "127.0.0.1");
  });

const freePort = async (preferred, span = 20) => {
  for (let port = preferred; port < preferred + span; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port between ${preferred} and ${preferred + span - 1}`);
};

const children = [];
const start = (command, args, env) => {
  const child = spawn(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  return child;
};

const appPort = await freePort(PREFERRED.app);
const fixturePort = await freePort(PREFERRED.fixture);

// 127.0.0.1 rather than localhost: the fixture listens on IPv4 only, and
// localhost resolves to ::1 first on many machines, which fails every request.
const fixtureUrl = `http://127.0.0.1:${fixturePort}`;

process.stdout.write(`Fixture API on ${fixtureUrl}\n`);
start("node", ["e2e/fixtures/server.mjs"], { FIXTURE_PORT: String(fixturePort) });

/* Identity, not liveness. `/api/health` answers whether or not this is the
 * fixture, so something else on this port would fill the explorer with records
 * that describe nothing. `/__control` is the fixture's own name for itself. */
const FIXTURE_ID = "midgard-explorer-e2e";
const deadline = Date.now() + 30_000;
let ready = false;
while (Date.now() < deadline && !ready) {
  ready = await fetch(`${fixtureUrl}/__control`, { signal: AbortSignal.timeout(2000) })
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => body?.fixture === FIXTURE_ID)
    .catch(() => false);
  if (!ready) await new Promise((wait) => setTimeout(wait, 250));
}
if (!ready) {
  process.stderr.write(`The fixture API did not come up on ${fixtureUrl}\n`);
  for (const child of children) child.kill("SIGTERM");
  process.exit(1);
}

process.stdout.write(`Explorer on http://127.0.0.1:${appPort}\n`);
process.stdout.write("The records shown are fixture data, not a Midgard deployment.\n\n");

// `next` directly, not through `pnpm exec`. pnpm does not pass a signal on to
// the command it runs, so a wrapper here would leave the dev server holding the
// port and the project's dev lock after this command stopped.
start("./node_modules/.bin/next", ["dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
  NEXT_PUBLIC_API_BASE: fixtureUrl,
  API_BASE_SERVER: fixtureUrl,
  NEXT_PUBLIC_NETWORK_LABEL: "Demo",
  NEXT_PUBLIC_L1_EXPLORER_NAME: "CExplorer",
  NEXT_PUBLIC_L1_EXPLORER_TX_URL: "https://preprod.cexplorer.io/tx/{hash}",
  NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL: "https://preprod.cexplorer.io/address/{address}",
});

/* Both children stop together. The fixture holds a port and Next holds the
 * project's dev lock, so one surviving the other leaves the next run reporting
 * a conflict whose cause is this command. */
let stopping = false;
const stopAll = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(0);
  }, 5000).unref();
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
for (const child of children) child.on("close", stopAll);
