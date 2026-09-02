#!/usr/bin/env node
/**
 * The backend's development lifecycle.
 *
 * One command starts everything this package needs and then runs the server in
 * the foreground, so its logs are the terminal's output and Ctrl-C stops it.
 * A contributor runs two commands in two terminals, and neither of them is
 * docker, prisma, or a script that generates a file in another directory:
 *
 *   cd backend      && pnpm dev
 *   cd frontend-new && pnpm dev
 *
 * Commands, each behind a pnpm script of the same name:
 *   setup [--force]      write backend/.env and the local index credentials
 *   doctor [mode]        what is wrong, and the command that fixes it
 *   dev                  the API, against an existing Midgard database
 *   dev --with-l1-sync   the same, and index Cardano as well
 *   status               what is running
 *   services:down        stop the containers this package started
 *
 * Nothing here deletes a volume, a database or any Midgard state.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkOwnership,
  clearAdoption,
  compose,
  readAdoption,
  recordAdoption,
  servicesToStop,
} from "./lib/compose.mjs";
import { effectiveIndexUrl, expand, parseEnvFile, redact, urlTarget } from "./lib/env.mjs";
import { descendants } from "./lib/proc.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..");

/** The one container normal development needs.
 *
 * The API cache is not started. It is an Nginx in front of this process, and
 * nothing about the API's meaning changes when it is absent: the frontend talks
 * to this server directly. Deployment runs it, and verifying the cached shape
 * belongs there rather than in a development command. */
const DEV_SERVICES = ["explorer-postgres"];

/** This package's own adoption record, so a stop can tell a container it
 * started from one it found already running. */
const SCOPE = "backend";

const bold = (text) => (process.stdout.isTTY ? `[1m${text}[0m` : text);
const red = (text) => (process.stderr.isTTY ? `[31m${text}[0m` : text);

const say = (text) => process.stdout.write(`${text}\n`);
const step = (text) => process.stdout.write(`${bold(text)}\n`);

/** Every failure names its cause and the next command to run. */
const die = (message, hint) => {
  process.stderr.write(`${red(message)}\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.exit(1);
};

const run = (command, args, options = {}) =>
  new Promise((resolveRun) => {
    const child = spawn(command, args, { stdio: "pipe", ...options });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    child.on("error", () => resolveRun({ code: 127, output }));
    child.on("close", (code) => resolveRun({ code, output }));
  });

// --- preflight ---------------------------------------------------------------

const requireToolchain = async () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    die(`Node ${process.versions.node} is too old; this package requires 24.`, "Run: nvm use 24");
  }
  const docker = await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (docker.code !== 0) {
    die(
      "Docker is not reachable.",
      "The explorer's own PostgreSQL runs in it. Start Docker, then run this again.",
    );
  }
};

const backendEnvPath = join(packageRoot, ".env");

const readBackendEnv = () => {
  const parsed = parseEnvFile(backendEnvPath);
  if (parsed === null) {
    die("backend/.env does not exist.", "Run: pnpm setup");
  }
  return expand(parsed);
};

/** The settings a person has to supply, because nothing can invent them. */
const MUST_BE_SUPPLIED = [
  ["POSTGRES_URL", "the Midgard node's own database"],
  ["INDEXER_POSTGRES_URL", "the explorer's index"],
];

const requireConfiguration = (env) => {
  const missing = MUST_BE_SUPPLIED.filter(([key]) => (env.get(key) ?? "") === "");
  if (missing.length > 0) {
    die(
      `backend/.env does not name ${missing.map(([, what]) => what).join(" or ")}.`,
      "Run: pnpm setup, then fill the values it lists",
    );
  }
  const node = urlTarget(env.get("POSTGRES_URL") ?? "");
  if (node === null || node.database === "") {
    die("POSTGRES_URL does not name a database.", "Fill the POSTGRES_* values in backend/.env");
  }
  return node;
};

// --- containers --------------------------------------------------------------

const startServices = async () => {
  step("Starting the explorer's own PostgreSQL");
  // Recorded before anything starts, so a run that fails later still leaves the
  // stop path able to tell a container it found from one it started.
  const adopted = await recordAdoption(repoRoot, { scope: SCOPE, services: DEV_SERVICES });
  if (adopted === null) {
    die("Could not ask Docker what is already running.", "Start Docker, then run this again.");
  }
  const up = await compose(repoRoot, ["up", "-d", ...DEV_SERVICES]).then(
    () => ({ code: 0 }),
    (error) => ({ code: 1, error }),
  );
  if (up.code !== 0) {
    die(
      "docker compose could not start explorer-postgres.",
      `Run it directly to see why: docker compose --env-file ${join(repoRoot, ".dev", "runtime.env")} up explorer-postgres`,
    );
  }
  say(`  explorer-postgres is up${adopted.length > 0 ? `, adopted from a session already running` : ""}`);
  return adopted;
};

const migrate = async () => {
  step("Applying the index migrations");
  const { problems, source } = await checkOwnership(repoRoot);
  if (problems.length > 0) {
    process.stderr.write(
      `${red(`INDEXER_POSTGRES_URL, from ${source}, does not name the database this repository provisions:`)}\n`,
    );
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    die(
      "Refusing to migrate an index this package does not own.",
      "Migrate it through the rollout instead: ./scripts/rollout.sh --apply",
    );
  }
  const result = await run("pnpm", ["--silent", "indexer:deploy"], { cwd: packageRoot });
  if (result.code !== 0) {
    process.stderr.write(`${result.output}\n`);
    die("The index migrations did not apply.", "Run: pnpm indexer:deploy");
  }
  say("  index schema is current");
};

const probeReadiness = async (scope) => {
  step(scope === "l2" ? "Checking it can serve L2 reads" : "Checking strict readiness");
  const args = scope === "l2"
    ? ["--silent", "readiness", "--", "--scope=l2"]
    : ["--silent", "readiness"];
  const result = await run("pnpm", args, { cwd: packageRoot });
  if (result.code !== 0) {
    for (const line of result.output.split("\n")) {
      if (line.startsWith("NOT READY")) process.stderr.write(`  ${line}\n`);
    }
    die(
      scope === "l2"
        ? "The explorer cannot serve L2 reads yet."
        : "Strict readiness is not met.",
      "The lines above name the probe that failed. Run: pnpm doctor",
    );
  }
  say("  node database and index are ready");
};

// --- the server, in the foreground -------------------------------------------

/**
 * Runs the API and stays attached to it.
 *
 * stdio is inherited, so the server's log is this terminal's output rather than
 * something to go and read. Ctrl-C reaches the child through the terminal's own
 * signal, and this process waits for it to exit before returning, so the
 * shutdown is the server's own rather than a killed pipe.
 *
 * The containers are left running. They hold the index, they are what the next
 * `pnpm dev` adopts, and stopping them here would make Ctrl-C a data-lifecycle
 * command. `pnpm services:down` is the verb that stops them.
 */
const serve = async (withL1Sync, manifestPath) => {
  step(withL1Sync ? "Starting the API and the L1 indexer" : "Starting the API");
  say("");
  // The same process group, deliberately.
  //
  // Ctrl-C in a terminal signals every process in the foreground group, which
  // is how the server, the pnpm that launched it and this process all stop
  // together. Putting the child in its own group broke exactly that: the
  // server outlived the command and kept the port.
  const child = spawn("pnpm", ["--silent", "dev:server"], {
    cwd: packageRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      L1_SYNC_ENABLED: withL1Sync ? "true" : "false",
      ...(withL1Sync && manifestPath ? { MIDGARD_MANIFEST_PATH: manifestPath } : {}),
    },
  });

  let stopping = false;
  const forward = () => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(
      "\nStopping the API. The containers keep running; stop them with: pnpm services:down\n",
    );
    // Signalled by descent rather than by group, because `pnpm` does not pass a
    // signal on to the command it runs: the server sits two forks below and
    // would otherwise keep the port after this command returned. In a terminal
    // the group signal has usually done the work already, and signalling a
    // process that has gone is not an error.
    for (const pid of descendants(child.pid).reverse()) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);

  const code = await new Promise((resolveServe) => child.on("close", resolveServe));
  process.exit(code ?? 0);
};

/**
 * Reports the cursors while the indexer moves them, and says when strict
 * readiness is met.
 *
 * Strict readiness is what this run is working towards rather than a
 * precondition for it, so it is watched rather than demanded. Nothing here
 * writes a cursor: one is written only inside a pass where every source
 * completed, which is what makes the three heights a record of a finished
 * reconciliation rather than a progress bar.
 */
const watchReconciliation = (port) => {
  const base = `http://127.0.0.1:${port}`;
  let last = "";
  let timer;
  const tick = async () => {
    const ready = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(5000) })
      .then((res) => res.ok)
      .catch(() => false);
    if (ready) {
      say("");
      say("Strict readiness met: every source completed a pass and the cursors agree.");
      return;
    }
    const summary = await fetch(`${base}/api/l1/summary`, { signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    if (summary?.sync) {
      const line = `${summary.sync.state}: ${summary.sync.cursors
        .map((cursor) => `${cursor.source}=${cursor.height ?? 0}`)
        .join(" ")}`;
      if (line !== last) {
        say(`  ${line}`);
        last = line;
      }
    }
    timer = setTimeout(tick, 15_000);
    timer.unref();
  };
  timer = setTimeout(tick, 5_000);
  timer.unref();
};

// --- commands ----------------------------------------------------------------

const commandSetup = async (extra) => {
  const result = await run(
    process.execPath,
    [join(packageRoot, "scripts", "setup.mjs"), repoRoot, "existing", ...extra],
    { cwd: repoRoot },
  );
  process.stdout.write(result.output);
  if (result.code !== 0) process.exit(result.code);
};

/** The mode a report is about. `existing` unless one is named, because that is
 * the mode `pnpm dev` starts and the only one this package can be asked about
 * without a flag. `full` reports on the explorer's own requirements under the
 * strict scope; ADR 3 records what it does not check. */
const commandDoctor = async (extra) => {
  const mode = extra.find((argument) => !argument.startsWith("-")) ?? "existing";
  const flags = extra.filter((argument) => argument.startsWith("-"));
  const child = spawn(
    process.execPath,
    [join(packageRoot, "scripts", "doctor.mjs"), repoRoot, mode, ...flags],
    { stdio: "inherit" },
  );
  const code = await new Promise((resolveDoctor) => child.on("close", resolveDoctor));
  process.exit(code ?? 0);
};

const commandDev = async (withL1Sync) => {
  await requireToolchain();
  const env = readBackendEnv();
  requireConfiguration(env);

  let manifestPath = null;
  if (withL1Sync) {
    manifestPath = env.get("MIDGARD_MANIFEST_PATH") ?? "";
    if (manifestPath === "" || !existsSync(manifestPath)) {
      die(
        "Indexing needs a deployment manifest, and MIDGARD_MANIFEST_PATH names no file.",
        "A Midgard deployment has no on-chain identifier: the manifest says which contracts to follow.",
      );
    }
    if ((env.get("KOIOS_BASE_URL") ?? "") === "") {
      die("Indexing needs KOIOS_BASE_URL.", "Set it in backend/.env");
    }
  }

  await startServices();
  await migrate();
  // The L2 scope, whether or not this run indexes.
  //
  // Strict readiness requires a completed reconciliation, and only the indexer
  // this command is about to start can produce one. Demanding it first meant
  // `pnpm dev:l1` could never bootstrap an index that had never been built:
  // the check failed on the very state it was being run to fix.
  await probeReadiness("l2");

  // The port the server will actually bind: dotenv leaves a non-empty process
  // variable alone, so an override on the command line wins over the file.
  const port = process.env.BACKEND_PORT || env.get("BACKEND_PORT") || "3101";
  say("");
  say(`API:       http://127.0.0.1:${port}`);
  say(`Mode:      ${withL1Sync ? "serving L2 reads and indexing Cardano" : "serving L2 reads"}`);
  if (!withL1Sync) {
    say("           L1 pages show what the index already holds. Add pnpm dev:l1 to index.");
  }
  say(`Frontend:  cd ../frontend-new && pnpm dev`);
  if (withL1Sync) watchReconciliation(port);
  await serve(withL1Sync, manifestPath);
};

const commandStatus = async () => {
  const env = parseEnvFile(backendEnvPath);
  const values = env === null ? new Map() : expand(env);
  const port = process.env.BACKEND_PORT || values.get("BACKEND_PORT") || "3101";
  const adopted = readAdoption(repoRoot, SCOPE);

  const health = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(3000),
  }).then((res) => res.ok, () => false);
  say(`API:        ${health ? `answering on http://127.0.0.1:${port}` : "not answering"}`);

  const containers = await run("docker", [
    "ps", "--filter", "name=midgard-explorer-postgres", "--format", "{{.Status}}",
  ]);
  say(`PostgreSQL: ${containers.output.trim() || "not running"}`);
  say(
    `Containers: ${
      adopted === null
        ? "none started by this package"
        : `started here, leaving ${adopted.length > 0 ? adopted.join(", ") : "none"} alone on stop`
    }`,
  );

  const { url } = effectiveIndexUrl({
    processEnv: process.env,
    backendEnv: values,
    runtime: null,
  });
  say(`Index:      ${url === "" ? "not configured" : redact(url)}`);
};

const commandServicesDown = async () => {
  const adopted = readAdoption(repoRoot, SCOPE);
  if (adopted === null) {
    say("No containers were started by this package, so none are stopped.");
    return;
  }
  // Only what this package starts. `pnpm dev` never starts the API cache, so a
  // stop that defaulted to every Compose service stopped one it did not own.
  const stopping = servicesToStop(adopted, DEV_SERVICES);
  if (stopping.length > 0) {
    // `stop`, never `down`. `down` removes containers and `down -v` removes the
    // volume holding the index.
    await compose(repoRoot, ["stop", ...stopping]).catch(() => {});
    say(`Stopped: ${stopping.join(", ")}`);
  }
  if (adopted.length > 0) {
    say(`Left running, because they were already up: ${adopted.join(", ")}`);
  }
  clearAdoption(repoRoot, SCOPE);
  say("No volume, database or Midgard state was removed.");
};

// --- dispatch ----------------------------------------------------------------

const [, , command, ...args] = process.argv;
const withL1Sync = args.includes("--with-l1-sync");

switch (command) {
  case "setup":
    await commandSetup(args);
    break;
  case "doctor":
    await commandDoctor(args);
    break;
  case "dev":
    await commandDev(withL1Sync);
    break;
  case "status":
    await commandStatus();
    break;
  case "services:down":
    await commandServicesDown();
    break;
  default:
    process.stderr.write(
      `Unknown command: ${command ?? "(none)"}\n` +
        "  Use: setup, doctor, dev [--with-l1-sync], status, services:down\n",
    );
    process.exit(2);
}
