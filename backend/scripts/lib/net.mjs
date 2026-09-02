#!/usr/bin/env node
/**
 * Port and identity helpers for the `dev` command.
 *
 * These live in Node rather than in the shell because the repository already
 * requires Node, while `lsof`, `ss` and `nc` are each absent from some machine
 * a contributor will use. Binding a socket is also the only check that answers
 * the question actually being asked: not "does something appear to hold this
 * port" but "can this process listen on it".
 *
 * Usage:
 *   net.mjs free-port <preferred> [span]   print the first bindable port
 *   net.mjs wait-fixture <base> <ms>       wait until <base> is this repo's fixture
 *   net.mjs wait-app <base> <ms>           wait until <base> is this explorer
 *   net.mjs check-fixture <base>           one shot, for status
 *   net.mjs check-app <base>               one shot, for status
 *   net.mjs wait-health <base> <ms>        wait until the backend answers /healthz
 *   net.mjs check-health <base>            one shot, for status
 *   net.mjs sync-state <apiBase>           the L1 index state and every cursor
 *   net.mjs ready-check <backendBase>      strict /readyz, naming what failed
 *   net.mjs dev-lock <appDir>              report a live `next dev` for that app
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";

/* The fixture's own identity string, from e2e/fixtures/server.mjs. The e2e
 * global setup and the canvas reliability script each carry the same literal:
 * it is the contract that says a process on this port belongs to this
 * repository, and adopting whatever answers instead has produced whole runs of
 * results that described a foreign service. */
const FIXTURE_ID = "midgard-explorer-e2e";

/** Whether 127.0.0.1:port can be bound right now. */
const portFree = (port) =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });

/** The first bindable port at or above `preferred`, or null within `span`. */
const freePort = async (preferred, span) => {
  for (let port = preferred; port < preferred + span; port += 1) {
    if (await portFree(port)) return port;
  }
  return null;
};

/** Fetch with a per-attempt deadline, so one hung socket cannot consume the
 * whole wait budget. */
const get = (url, timeoutMs = 2_000) =>
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

/** True, or the reason this is not the fixture. */
const probeFixture = async (base) => {
  const res = await get(`${base}/__control`);
  if (!res.ok) return `answered ${res.status}`;
  const body = await res.json().catch(() => null);
  if (body?.fixture !== FIXTURE_ID) {
    return `answered as "${body?.fixture ?? "something else"}", not ${FIXTURE_ID}`;
  }
  return true;
};

/* The app identifies itself by a route contract rather than by a health
 * verdict: `/api/health` answers `{ up: boolean }` whether or not a backend is
 * reachable, so the shape says this is the explorer while the value says
 * nothing about whether it is well.
 *
 * The overview page is then requested as well, because identity is not
 * readiness. A route handler compiles without the stylesheet every page pulls
 * in, so `/api/health` answered 200 through a bundler failure that made every
 * page return 500, and demo mode reported itself healthy while serving nothing.
 * The page request is what the contributor is about to make. */
const probeApp = async (base) => {
  const health = await get(`${base}/api/health`);
  if (!health.ok) return `answered ${health.status} on /api/health`;
  const body = await health.json().catch(() => null);
  if (typeof body?.up !== "boolean") return "did not answer /api/health as this explorer";

  const page = await get(`${base}/`, 120_000);
  if (!page.ok) return `answered ${page.status} on the overview page`;
  return true;
};

/* Next refuses a second `next dev` for one project directory, whatever port it
 * is given, so a free port is not enough to know the app can start. It records
 * the running server in .next/dev/lock, which is the only check that answers
 * before the failure rather than after it. A lock whose pid is gone is stale
 * and means nothing. */
const devLock = (appDir) => {
  let raw;
  try {
    raw = readFileSync(join(appDir, ".next", "dev", "lock"), "utf8");
  } catch {
    return null;
  }
  let lock;
  try {
    lock = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Number.isInteger(lock?.pid)) return null;
  try {
    process.kill(lock.pid, 0);
  } catch {
    return null;
  }
  return lock;
};

/* The backend's liveness probe. It touches no database on purpose, so this says
 * the process is up and answering, and nothing about whether it can serve. The
 * readiness scopes answer that. */
const probeHealth = async (base) => {
  const res = await get(`${base}/healthz`);
  if (!res.ok) return `answered ${res.status} on /healthz`;
  const body = await res.json().catch(() => null);
  if (body?.status !== "ok") return "did not answer /healthz as the explorer backend";
  return true;
};

/* The index's own account of how much of the chain it holds, read from the same
 * summary the L1 page reads. Reported as every cursor rather than a verdict,
 * because three heights that disagree name the source that is behind. */
const syncState = async (base) => {
  const res = await get(`${base}/api/l1/summary`, 10_000);
  if (!res.ok) throw new Error(`/api/l1/summary answered ${res.status}`);
  const body = await res.json();
  return body?.sync ?? { state: "unknown", cursors: [] };
};

/* Strict readiness, the question `/readyz` answers and a deployment gates on.
 * The failing check is named; why it failed goes to the backend log and never
 * to the response, so the reason comes from
 * `pnpm doctor --with-l1-sync`, which is the scope that covers it. */
const readyCheck = async (base) => {
  const res = await get(`${base}/readyz`, 20_000);
  const body = await res.json().catch(() => null);
  if (res.ok && body?.ready === true) return true;
  const failed = (body?.checks ?? []).filter((c) => !c.ok).map((c) => c.name);
  return failed.length > 0 ? `not ready: ${failed.join(", ")}` : `answered ${res.status}`;
};

/** Poll `check` until it returns true. Resolves to null on success, or the last
 * reason on timeout. */
const poll = async (check, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let reason = "no response";
  for (;;) {
    try {
      const result = await check();
      if (result === true) return null;
      reason = result;
    } catch (error) {
      reason = String(error?.message ?? error);
    }
    if (Date.now() >= deadline) return reason;
    await new Promise((resume) => setTimeout(resume, 300));
  }
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/* `doctor` imports these rather than shelling out to this file once per check.
 * The command line below runs only when this file is the entry point, so an
 * import does not fall through to the unknown-command branch and exit. */
export { portFree, freePort, devLock, probeFixture, probeApp, probeHealth, syncState, poll };

const [, , command, ...args] = process.argv;
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (!isEntryPoint) {
  // Imported as a library. Nothing to run.
} else
switch (command) {
  case "free-port": {
    const preferred = Number(args[0]);
    const span = Number(args[1] ?? 20);
    if (!Number.isInteger(preferred)) fail("free-port needs a port number");
    const port = await freePort(preferred, span);
    if (port === null) {
      fail(`no free port between ${preferred} and ${preferred + span - 1} on 127.0.0.1`);
    }
    process.stdout.write(`${port}\n`);
    break;
  }
  case "wait-fixture":
  case "wait-app":
  case "wait-health": {
    const [base, ms] = args;
    if (!base) fail(`${command} needs a base URL`);
    const probe =
      command === "wait-fixture" ? probeFixture : command === "wait-app" ? probeApp : probeHealth;
    const reason = await poll(() => probe(base), Number(ms ?? 60_000));
    if (reason !== null) fail(`${base} ${reason}`);
    break;
  }
  case "check-fixture":
  case "check-app":
  case "check-health": {
    const [base] = args;
    if (!base) fail(`${command} needs a base URL`);
    const probe =
      command === "check-fixture" ? probeFixture : command === "check-app" ? probeApp : probeHealth;
    const result = await probe(base).catch((error) => String(error?.message ?? error));
    if (result !== true) fail(String(result));
    break;
  }
  case "sync-state": {
    const [base] = args;
    if (!base) fail("sync-state needs the API base URL");
    const sync = await syncState(base).catch((error) => {
      fail(String(error?.message ?? error));
    });
    const cursors = sync.cursors.map((c) => `${c.source}=${c.height ?? 0}`).join(" ");
    process.stdout.write(`${sync.state} ${cursors}\n`);
    break;
  }
  case "ready-check": {
    const [base] = args;
    if (!base) fail("ready-check needs the backend base URL");
    const result = await readyCheck(base).catch((error) => String(error?.message ?? error));
    if (result !== true) fail(String(result));
    process.stdout.write("ready\n");
    break;
  }
  case "dev-lock": {
    const [appDir] = args;
    if (!appDir) fail("dev-lock needs the app directory");
    const lock = devLock(appDir);
    if (lock === null) process.exit(1);
    process.stdout.write(`${lock.pid} ${lock.appUrl ?? `port ${lock.port}`}\n`);
    break;
  }
  default:
    fail(`unknown command: ${command ?? "(none)"}`);
}
