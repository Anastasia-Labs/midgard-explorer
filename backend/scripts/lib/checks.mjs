/**
 * The checks `dev doctor` runs.
 *
 * Every check is one entry in CHECKS with a stable `id`, the modes it applies
 * to, and a `run` that returns a status. Adding a check for a mode PRs 4 to 7
 * build means appending an entry, not changing the runner: the runner filters
 * on `modes` and knows nothing about what any check does.
 *
 * Checks are read-only. Nothing here installs, migrates, starts a service or
 * writes a file, so `doctor` is safe to run against a machine mid-incident.
 *
 * Status: pass, warn, fail, skip.
 *   fail  the mode cannot work until this is fixed. Sets the exit code.
 *   warn  worth knowing, does not stop the mode.
 *   skip  not applicable here, or could not be determined. Says which.
 *
 * A check that throws is reported by the runner as `error`, which also sets the
 * exit code: a check nobody could run is not a check that passed.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync, statfsSync } from "node:fs";
import { createConnection } from "node:net";
import { platform, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { devLock, portFree } from "./net.mjs";
import {
  GENERATED_FILES,
  RUNTIME_LINKS,
  expand,
  isPlaceholder,
  parseEnvFile,
  redact,
  urlTarget,
} from "./env.mjs";

const run = promisify(execFile);

const pass = (detail) => ({ status: "pass", detail });
const warn = (detail, hint) => ({ status: "warn", detail, hint });
const fail = (detail, hint) => ({ status: "fail", detail, hint });
const skip = (detail) => ({ status: "skip", detail });

/* Measured, not chosen. `demo` is the hard floor at which the development server
 * still served the overview under an enforced ceiling; `existing` adds the
 * backend and the two containers. `full` has no measurement, because nothing
 * here runs it and the Cardano services dominate the answer, so its figure stays
 * a guess and says so where it is reported.
 * See docs/resource-requirements.md. */
const FLOOR_MB = { demo: 1024, existing: 3072, full: 8192 };
const MEASURED = new Set(["demo", "existing"]);

/* Settings backend/src/config.ts declares with no default. A value that is
 * absent or empty stops the process at boot with a list, so doctor reports the
 * same list before anything is started. */
export const REQUIRED_BACKEND_ENV = [
  "BACKEND_PORT",
  "POSTGRES_URL",
  "LOG_LOCATION",
  "RECENT_BLOCKS_LIMIT",
  "RECENT_TRANSACTIONS_LIMIT",
  "TRANSACTIONS_PER_PAGE",
  "BLOCKS_PER_PAGE",
  "INDEXER_POSTGRES_URL",
  "KOIOS_BASE_URL",
  "L1_SYNC_INTERVAL_MS",
  "L1_REORG_LOOKBACK_BLOCKS",
];

/* Required only when the indexer runs, matching the same rule in config.ts.
 * The manifest names the L1 deployment, and an explorer serving L2 records
 * never opens it. */
export const REQUIRED_WHEN_INDEXING = ["MIDGARD_MANIFEST_PATH"];

const ALL = ["demo", "existing", "full"];
const REAL_DATA = ["existing", "full"];

// --- shared helpers ---------------------------------------------------------

/** Whether a TCP connection to host:port completes. Reachability only: it opens
 * nothing, sends nothing, and says nothing about what is listening. */
const tcpReachable = (host, port, timeout = 3000) =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });

/** The parent of a process, from /proc where it exists and `ps` elsewhere. */
const parentOf = async (pid) => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^PPid:\s+(\d+)/m);
    if (match) return Number(match[1]);
  } catch {
    // Not Linux, or the process is gone. Fall through to ps.
  }
  try {
    const { stdout } = await run("ps", ["-o", "ppid=", "-p", String(pid)], { timeout: 5_000 });
    const parent = Number(stdout.trim());
    return Number.isInteger(parent) ? parent : null;
  } catch {
    return null;
  }
};

/** Whether `pid` descends from `ancestor`. The pid a launcher records is the
 * command it ran, while the pid a server writes into its own lock file is the
 * server itself, one or more forks below. Comparing the two directly says they
 * are unrelated when they are the same service. */
const isDescendantOf = async (pid, ancestor) => {
  let current = pid;
  for (let hop = 0; hop < 20 && current > 1; hop += 1) {
    if (current === ancestor) return true;
    const parent = await parentOf(current);
    if (parent === null) return false;
    current = parent;
  }
  return false;
};

/** MemAvailable is the only figure that accounts for reclaimable cache, so
 * `free` memory on Linux understates what a process can actually get. */
const memoryMb = () => {
  try {
    const info = readFileSync("/proc/meminfo", "utf8");
    const read = (key) => Number(info.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"))?.[1] ?? NaN);
    return {
      available: Math.round(read("MemAvailable") / 1024),
      swapTotal: Math.round(read("SwapTotal") / 1024),
      swapFree: Math.round(read("SwapFree") / 1024),
      total: Math.round(read("MemTotal") / 1024),
    };
  } catch {
    return { available: null, swapTotal: null, swapFree: null, total: Math.round(totalmem() / 1048576) };
  }
};

/** Whether this configuration runs the indexer.
 *
 * Read from backend/.env rather than assumed, because it decides which of two
 * questions doctor is answering: whether the explorer can serve L2 records, or
 * whether it could be put into rotation. `pnpm dev:l1` asks the second one for
 * a single run and checks the manifest itself. */
const indexingConfigured = (ctx) => {
  // Asked for on the command line. `pnpm doctor --with-l1-sync` is the
  // question "would this serve L1 too?", and it is the question a failed
  // `pnpm dev:l1` sends the reader here to ask.
  if (ctx.withL1Sync) return true;

  // Or already true of a run that is up. `pnpm dev:l1` sets
  // L1_SYNC_ENABLED for that process only, so backend/.env still says false
  // while an indexer is running, and doctor would have answered the narrower
  // question about the wider system.
  const state = parseEnvFile(join(ctx.repoRoot, ".dev", ctx.mode, "state.env"));
  if (state?.get("EXISTING_WITH_L1_SYNC") === "1") return true;

  // Absent means indexing, matching the default in backend/src/config.ts: one
  // process indexes, and an extra read-only instance opts out explicitly. A
  // doctor that read absence as "not indexing" would answer the narrower
  // question for a .env that runs the indexer.
  const value = (backendEnv(ctx)?.get("L1_SYNC_ENABLED") ?? "").toLowerCase();
  if (value === "") return true;
  return value === "true" || value === "1";
};

/** Which readiness scope this mode is asking about.
 *
 * ADR 3 records the two: `full` is what `/readyz` answers and what a rollout
 * gates on, `l2` is whether this process can serve L2 blocks, transactions,
 * addresses and UTxOs. Running the full scope against a development machine
 * reports "not ready" for pages that render correctly, which is how a check
 * teaches its reader to ignore it. */
const readinessScope = (ctx) =>
  ctx.mode === "existing" && !indexingConfigured(ctx) ? "l2" : "full";

/** Probes the L2 scope runs, mirroring PROBES in backend/scripts/probe-readiness.ts. */
const L2_PROBES = new Set(["node database", "explorer index"]);

/** The backend's own readiness probe, run once and shared by the checks that
 * read it. Doctor does not re-implement which relations the query path needs:
 * probes.ts is where that list lives, and a second copy would drift from it. */
const readinessReport = async (ctx) => {
  if (ctx._readiness !== undefined) return ctx._readiness;
  const scope = readinessScope(ctx);
  ctx._readiness = (async () => {
    if (!existsSync(join(ctx.repoRoot, "backend", "node_modules"))) {
      return { scope, available: false, reason: "backend dependencies are not installed" };
    }
    const argv = scope === "full"
      ? ["--silent", "readiness"]
      : ["--silent", "readiness", "--", `--scope=${scope}`];
    try {
      const { stdout } = await run("pnpm", argv, {
        cwd: join(ctx.repoRoot, "backend"),
        timeout: 60_000,
        env: { ...process.env, NO_COLOR: "1" },
      });
      return { scope, available: true, lines: stdout.split("\n") };
    } catch (error) {
      // A non-zero exit is the normal case: the probe exits 1 when any probe is
      // not ready, and its output is still the answer.
      const stdout = String(error?.stdout ?? "");
      if (stdout.includes("READY") || stdout.includes("NOT READY")) {
        return { scope, available: true, lines: stdout.split("\n") };
      }
      return {
        scope,
        available: false,
        reason: redact(String(error?.stderr || error?.message || error)),
      };
    }
  })();
  return ctx._readiness;
};

/** One probe's line from that report.
 *
 * A probe outside the scope that ran did not answer, and reporting it as a
 * failure would contradict the scope doctor deliberately chose. It warns
 * instead, and says when the answer starts to matter. */
const readinessCheck = (probeName, { outsideScope } = {}) =>
  async (ctx) => {
    const report = await readinessReport(ctx);
    // Not a skip. A probe that did not answer is not a probe that passed, and
    // skips do not set the exit code, so this was the remaining way for doctor
    // to print "Ready" over a question nobody answered.
    if (!report.available) {
      return fail(
        `could not run the readiness probe: ${report.reason}`,
        "Doctor cannot say whether this mode would serve until the probe runs. Try: cd backend && pnpm readiness",
      );
    }
    if (report.scope === "l2" && !L2_PROBES.has(probeName)) {
      return warn(
        `not checked: "${probeName}" is outside the L2 scope this mode runs`,
        outsideScope ?? "Set L1_SYNC_ENABLED=true in backend/.env to have doctor check it",
      );
    }
    const line = report.lines.find((l) => l.includes(probeName));
    if (line === undefined) {
      // The probe ran, in a scope that covers this one, and said nothing about
      // it. That is doctor and probe-readiness.ts disagreeing about what exists.
      return {
        status: "error",
        detail: `the readiness probe ran the ${report.scope} scope and reported nothing for "${probeName}"`,
        hint: "PROBES in backend/scripts/probe-readiness.ts and the checks here name different probes",
      };
    }
    if (line.startsWith("READY")) return pass(`${probeName} is ready`);
    const reason = redact(line.replace(/^NOT READY\s+/, ""));
    return fail(reason, "Read backend/.env, then: cd backend && pnpm readiness");
  };

/** backend/.env, parsed and expanded once. */
const backendEnv = (ctx) => {
  if (ctx._env === undefined) {
    const parsed = parseEnvFile(join(ctx.repoRoot, "backend", ".env"));
    ctx._env = parsed === null ? null : expand(parsed);
  }
  return ctx._env;
};

const needsEnv = (ctx) => {
  const env = backendEnv(ctx);
  return env === null ? skip("backend/.env does not exist") : null;
};

// --- the checks -------------------------------------------------------------

export const CHECKS = [
  {
    id: "toolchain.node",
    title: "Node version",
    modes: ALL,
    run: async () => {
      const major = Number(process.versions.node.split(".")[0]);
      return major >= 24
        ? pass(`Node ${process.versions.node}`)
        : fail(`Node ${process.versions.node}; frontend-new requires 24`, "Run: nvm use 24");
    },
  },
  {
    id: "toolchain.pnpm",
    title: "pnpm version",
    modes: ALL,
    run: async () => {
      try {
        const { stdout } = await run("pnpm", ["--version"], { timeout: 15_000 });
        const version = stdout.trim();
        return version.startsWith("11.")
          ? pass(`pnpm ${version}`)
          : warn(`pnpm ${version}; this repository pins 11`, "Run: corepack enable");
      } catch {
        return fail("pnpm is not on PATH", "Run: corepack enable");
      }
    },
  },
  {
    id: "platform.os",
    title: "Operating system",
    modes: ALL,
    run: async () => {
      const os = platform();
      return os === "linux" || os === "darwin"
        ? pass(os)
        : warn(`${os} is untested for this stack`, "Linux and macOS are the platforms in use");
    },
  },
  {
    id: "platform.memory",
    title: "Available memory",
    modes: ALL,
    run: async (ctx) => {
      const { available, total } = memoryMb();
      if (available === null) return skip(`could not read available memory (total ${total} MB)`);
      const floor = FLOOR_MB[ctx.mode];
      const measured = MEASURED.has(ctx.mode);
      const detail = `${available} MB available of ${total} MB`;
      return available >= floor
        ? pass(detail)
        : warn(
            `${detail}, under the ${measured ? "measured" : "estimated"} ${floor} MB for ${ctx.mode} mode`,
            measured
              ? "Measured under an enforced ceiling: docs/resource-requirements.md"
              : "Estimated. Nothing here runs this mode, so nothing has measured it",
          );
    },
  },
  {
    id: "platform.swap",
    title: "Swap pressure",
    modes: ALL,
    run: async () => {
      const { swapTotal, swapFree } = memoryMb();
      if (swapTotal === null || swapTotal === 0) return skip("no swap configured");
      const usedPct = Math.round(((swapTotal - swapFree) / swapTotal) * 100);
      const detail = `${usedPct}% of ${swapTotal} MB swap in use`;
      return usedPct < 90
        ? pass(detail)
        : warn(
            detail,
            "A bundler worker missing its deadline reports a Turbopack panic on this stack; it has been seen only with memory exhausted",
          );
    },
  },
  {
    id: "platform.disk",
    title: "Free disk",
    modes: ALL,
    run: async (ctx) => {
      try {
        const fs = statfsSync(ctx.repoRoot);
        const freeGb = Math.round((fs.bavail * fs.bsize) / 1073741824);
        return freeGb >= 5
          ? pass(`${freeGb} GB free`)
          : warn(`${freeGb} GB free`, "Installs and build caches for this repository run to several GB");
      } catch {
        return skip("could not read filesystem statistics");
      }
    },
  },
  {
    id: "workspace.frontend-install",
    title: "frontend-new dependencies",
    modes: ALL,
    run: async (ctx) => {
      const installed =
        existsSync(join(ctx.repoRoot, "frontend-new", "node_modules")) &&
        existsSync(join(ctx.repoRoot, "frontend-new", "app", "node_modules"));
      return installed
        ? pass("installed")
        : warn("not installed", "Run: cd frontend-new && pnpm install");
    },
  },

  // --- demo -----------------------------------------------------------------
  {
    id: "demo.fixture-present",
    title: "Fixture backend",
    modes: ["demo"],
    run: async (ctx) => {
      const path = join(ctx.repoRoot, "frontend-new", "app", "e2e", "fixtures", "server.mjs");
      return existsSync(path) ? pass("present") : fail("frontend-new/app/e2e/fixtures/server.mjs is missing");
    },
  },
  {
    id: "dev.next-lock",
    title: "No other Next dev server",
    // Both modes serve frontend-new/app, so both compete for the one lock Next
    // allows on it. Reading only demo's recorded pid reported existing mode's
    // own server as a conflict.
    modes: ALL,
    run: async (ctx) => {
      const lock = devLock(join(ctx.repoRoot, "frontend-new", "app"));
      if (lock === null) return pass("frontend-new/app is free");
      const where = lock.appUrl ?? `port ${lock.port}`;
      // A server `dev` started is that mode working, not a conflict. Reporting
      // it as a failure would train the reader to ignore this check in exactly
      // the state where it is most often read.
      for (const mode of ["demo", "existing"]) {
        let ours = null;
        try {
          ours = Number(
            readFileSync(join(ctx.repoRoot, ".dev", mode, "app.pid"), "utf8").trim(),
          );
        } catch {
          continue;
        }
        if (ours === lock.pid || (await isDescendantOf(lock.pid, ours))) {
          return mode === ctx.mode
            ? pass(`${mode} mode is running on ${where} (pid ${lock.pid})`)
            : fail(
                `${mode} mode holds frontend-new/app on ${where} (pid ${lock.pid})`,
                "One dev server per project directory. Stop the one that holds it.",
              );
        }
      }
      return fail(
        `a Next dev server holds frontend-new/app on ${where} (pid ${lock.pid})`,
        `Next allows one dev server per project directory. Stop it with: kill ${lock.pid}`,
      );
    },
  },
  {
    id: "demo.ports",
    title: "Demo ports",
    modes: ["demo"],
    run: async () => {
      const wanted = { explorer: 3010, fixture: 3110 };
      const taken = [];
      for (const [name, port] of Object.entries(wanted)) {
        if (!(await portFree(port))) taken.push(`${name} ${port}`);
      }
      return taken.length === 0
        ? pass(`${wanted.explorer} and ${wanted.fixture} are free`)
        : warn(`${taken.join(", ")} in use`, "Demo mode selects the next free port automatically");
    },
  },

  // --- backend configuration, shared by existing and full ------------------
  {
    id: "backend.install",
    title: "backend dependencies",
    modes: REAL_DATA,
    run: async (ctx) =>
      existsSync(join(ctx.repoRoot, "backend", "node_modules"))
        ? pass("installed")
        : fail("not installed", "Run: cd backend && pnpm install"),
  },
  {
    id: "backend.env-file",
    title: "backend/.env",
    modes: REAL_DATA,
    run: async (ctx) =>
      backendEnv(ctx) === null
        ? fail("does not exist", "Run: cp backend/.env.example backend/.env")
        : pass("present"),
  },
  {
    id: "backend.env-complete",
    title: "Required settings",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const env = backendEnv(ctx);
      const required = indexingConfigured(ctx)
        ? [...REQUIRED_BACKEND_ENV, ...REQUIRED_WHEN_INDEXING]
        : REQUIRED_BACKEND_ENV;
      const absent = required.filter((key) => (env.get(key) ?? "") === "");
      return absent.length === 0
        ? pass(`all ${required.length} settings have a value`)
        : fail(
            `${absent.length} required settings are empty: ${absent.join(", ")}`,
            "The backend refuses to boot with these unset. Fill them in backend/.env",
          );
    },
  },
  {
    id: "backend.env-url-parts",
    title: "Connection strings are complete",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const env = backendEnv(ctx);
      // The shipped example composes POSTGRES_URL out of POSTGRES_USER and the
      // rest, each of which ships empty. The composed string is then non-empty,
      // so it satisfies the backend's own "must not be blank" rule and every
      // check that only asks whether a value is present, while naming no user
      // and no database.
      const broken = [];
      for (const key of ["POSTGRES_URL", "INDEXER_POSTGRES_URL"]) {
        const value = env.get(key) ?? "";
        if (value === "") continue;
        const target = urlTarget(value);
        if (target === null) {
          broken.push(`${key} is not a URL`);
          continue;
        }
        const parsed = new URL(value);
        if (parsed.username === "") broken.push(`${key} names no user`);
        if (target.database === "") broken.push(`${key} names no database`);
      }
      return broken.length === 0
        ? pass("user and database named in every connection string")
        : fail(broken.join("; "), "Fill the POSTGRES_* parts in backend/.env; the example ships them empty");
    },
  },
  {
    id: "backend.env-placeholders",
    title: "Example placeholders",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const env = backendEnv(ctx);
      const left = [...env.entries()]
        .filter(([, value]) => isPlaceholder(value))
        .map(([key]) => key);
      return left.length === 0
        ? pass("none left")
        : fail(
            `${left.length} settings still hold an example placeholder: ${left.join(", ")}`,
            "backend/.env was copied from the example and not filled in",
          );
    },
  },

  // --- generated configuration ---------------------------------------------
  {
    id: "config.runtime-env",
    title: "Generated configuration",
    modes: REAL_DATA,
    run: async (ctx) => {
      const runtime = parseEnvFile(join(ctx.repoRoot, ".dev", "runtime.env"));
      if (runtime === null) {
        return warn(
          ".dev/runtime.env does not exist",
          "Run: cd backend && pnpm setup. Without it, every service is configured by hand",
        );
      }
      return pass(`${runtime.size} settings, the source for every generated file`);
    },
  },
  {
    id: "config.permissions",
    title: "Secret file permissions",
    modes: REAL_DATA,
    run: async (ctx) => {
      const wide = [];
      for (const relative of [".dev/runtime.env", ...GENERATED_FILES]) {
        const path = join(ctx.repoRoot, relative);
        if (!existsSync(path)) continue;
        const mode = statSync(path).mode & 0o777;
        if (mode & 0o077) wide.push(`${relative} is ${mode.toString(8)}`);
      }
      return wide.length === 0
        ? pass("every file holding a credential is owner-only")
        : warn(
            wide.join(", "),
            "These hold a database password. Run: chmod 600 <file>",
          );
    },
  },
  {
    id: "config.drift",
    title: "Generated files match the source",
    modes: REAL_DATA,
    run: async (ctx) => {
      const parsed = parseEnvFile(join(ctx.repoRoot, ".dev", "runtime.env"));
      if (parsed === null) return skip(".dev/runtime.env does not exist");
      const runtime = expand(parsed);
      const drifted = [];
      for (const file of GENERATED_FILES) {
        const target = parseEnvFile(join(ctx.repoRoot, file));
        if (target === null) continue;
        const values = expand(target);
        for (const link of RUNTIME_LINKS.filter((l) => l.file === file)) {
          const wanted = runtime.get(link.runtime) ?? "";
          if (wanted === "") continue;
          if ((values.get(link.key) ?? "") !== wanted) drifted.push(`${file}:${link.key}`);
        }
      }
      return drifted.length === 0
        ? pass("no drift between .dev/runtime.env and the files generated from it")
        : warn(
            `${drifted.length} setting(s) differ: ${drifted.join(", ")}`,
            "Regenerate them with: pnpm setup --force (the current files are copied to .backup first)",
          );
    },
  },

  // --- existing mode --------------------------------------------------------
  {
    id: "existing.docker",
    title: "Docker daemon",
    modes: REAL_DATA,
    run: async () => {
      try {
        const { stdout } = await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
          timeout: 20_000,
        });
        return pass(`server ${stdout.trim()}`);
      } catch (error) {
        return fail(
          "not reachable",
          String(error?.message ?? "").includes("ENOENT")
            ? "Docker is not installed. The explorer's own PostgreSQL runs in it."
            : "Start Docker. The explorer's own PostgreSQL and API cache run in it.",
        );
      }
    },
  },
  {
    id: "existing.compose",
    title: "Docker Compose",
    modes: REAL_DATA,
    run: async () => {
      try {
        const { stdout } = await run("docker", ["compose", "version", "--short"], { timeout: 20_000 });
        return pass(stdout.trim());
      } catch {
        return fail("`docker compose` is unavailable", "Install the Compose v2 plugin");
      }
    },
  },
  {
    id: "existing.node-db-reachable",
    title: "Midgard PostgreSQL",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const target = urlTarget(backendEnv(ctx).get("POSTGRES_URL") ?? "");
      if (target === null) return fail("POSTGRES_URL is not a URL", "Check backend/.env");
      const up = await tcpReachable(target.host, target.port);
      return up
        ? pass(`${target.host}:${target.port} accepts connections`)
        : fail(
            `nothing accepts connections on ${target.host}:${target.port}`,
            "Start the Midgard node's PostgreSQL. See docs/running-full-midgard.md",
          );
    },
  },
  {
    id: "existing.index-db-reachable",
    title: "Explorer index PostgreSQL",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const target = urlTarget(backendEnv(ctx).get("INDEXER_POSTGRES_URL") ?? "");
      if (target === null) return fail("INDEXER_POSTGRES_URL is not a URL", "Check backend/.env");
      const up = await tcpReachable(target.host, target.port);
      return up
        ? pass(`${target.host}:${target.port} accepts connections`)
        : fail(
            `nothing accepts connections on ${target.host}:${target.port}`,
            "Run: docker compose up -d explorer-postgres",
          );
    },
  },
  {
    id: "existing.test-db-distinct",
    title: "Test index database",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const env = backendEnv(ctx);
      const test = env.get("TEST_INDEXER_POSTGRES_URL") ?? "";
      if (test === "") {
        return warn(
          "TEST_INDEXER_POSTGRES_URL is not set",
          "The database-backed backend tests need it; the suite truncates whatever it names",
        );
      }
      const target = urlTarget(test);
      if (target === null) return fail("TEST_INDEXER_POSTGRES_URL is not a URL", "Check backend/.env");
      if (!target.database.endsWith("_test")) {
        return fail(
          `the test database is named "${target.database}", which does not end in _test`,
          "The suite truncates this database and refuses any name that does not end in _test",
        );
      }
      const index = urlTarget(env.get("INDEXER_POSTGRES_URL") ?? "");
      if (index && index.database === target.database && index.host === target.host) {
        return fail(
          "the test database and the index are the same database",
          "The suite would truncate the index it is meant to read",
        );
      }
      return pass(`${target.database}, distinct from the index`);
    },
  },
  {
    id: "existing.manifest-file",
    title: "Deployment manifest",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const path = backendEnv(ctx).get("MIDGARD_MANIFEST_PATH") ?? "";
      // Absent is a configured state for an L2-only explorer, and a failure for
      // one that indexes. The same rule the backend's own configuration applies.
      const indexing = indexingConfigured(ctx);
      const absent = (detail) =>
        indexing
          ? fail(detail, "The indexer refuses to start without it, and /readyz refuses the process")
          : warn(
              detail,
              "Not needed to serve L2 records. Set it before `pnpm dev:l1`, and before this instance takes traffic",
            );
      if (path === "") return absent("MIDGARD_MANIFEST_PATH is not set");
      if (!existsSync(path)) {
        return indexing
          ? fail(
              `no file at ${path}`,
              "A Midgard deployment has no on-chain identifier, so the manifest is the only way to know which contracts to follow",
            )
          : warn(`no file at ${path}`, "Not read while this explorer serves L2 records only");
      }
      try {
        const manifest = JSON.parse(readFileSync(path, "utf8"));
        const version = manifest?.schemaVersion ?? "(none declared)";
        // Which versions this build supports is PR 7's compatibility contract.
        // Reporting the version without judging it keeps one source of truth.
        return pass(`schema version ${version}`);
      } catch (error) {
        return fail(`${path} is not readable JSON`, redact(String(error?.message ?? error)));
      }
    },
  },

  {
    id: "full.services-not-checked",
    title: "What this report does not cover",
    modes: ["full"],
    run: async () =>
      warn(
        "Cardano Node, Kupo, Ogmios, the Midgard checkout and wallet funding are not checked",
        "They are configured outside this repository, which holds no address to reach them at. docs/running-full-midgard.md is the procedure, and Step 6 is how it is verified",
      ),
  },

  // --- compatibility with the node this build reads -------------------------
  {
    id: "compat.node-schema",
    title: "Node schema compatibility",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const url = backendEnv(ctx).get("POSTGRES_URL") ?? "";
      if (url === "") return skip("POSTGRES_URL is not set");
      if (!existsSync(join(ctx.repoRoot, "backend", "node_modules"))) {
        return skip("backend dependencies are not installed");
      }
      try {
        const { stdout } = await run(
          "node",
          [join(ctx.repoRoot, "backend", "scripts", "compat.mjs"), ctx.repoRoot, "check", "--database", url],
          { timeout: 30_000 },
        );
        const lines = stdout.trim().split("\n");
        return lines.length > 1
          ? warn(lines[0].replace(/^compatible: /, ""), lines.slice(1).join("; ").trim())
          : pass(lines[0].replace(/^compatible: /, ""));
      } catch (error) {
        const output = redact(String(error?.stderr || error?.stdout || error?.message || error));
        return fail(
          output.split("\n")[0] || "the compatibility check did not complete",
          "This node does not hold something the read path queries. The explorer would answer pages that fail rather than refusing at startup.",
        );
      }
    },
  },
  {
    id: "compat.manifest-version",
    title: "Manifest schema version",
    modes: REAL_DATA,
    run: async (ctx) => {
      const missing = needsEnv(ctx);
      if (missing) return missing;
      const path = backendEnv(ctx).get("MIDGARD_MANIFEST_PATH") ?? "";
      if (path === "" || !existsSync(path)) return skip("no manifest to read");
      let config;
      try {
        config = JSON.parse(
          readFileSync(join(ctx.repoRoot, "config", "midgard-compatibility.json"), "utf8"),
        );
      } catch {
        return skip("config/midgard-compatibility.json is not readable");
      }
      let version;
      try {
        version = JSON.parse(readFileSync(path, "utf8"))?.schemaVersion;
      } catch {
        return skip("the manifest is not readable JSON");
      }
      const supported = config.manifestSchemaVersions ?? [];
      return supported.includes(version)
        ? pass(`${version}, which this build supports`)
        : fail(
            `${version ?? "(none declared)"} is outside ${supported.join(", ")}`,
            "The indexer refuses an unknown layout rather than reading it on a guess",
          );
    },
  },

  {
    id: "compat.deployment",
    title: "Deployment this build was verified against",
    modes: REAL_DATA,
    run: async (ctx) => {
      let config;
      try {
        config = JSON.parse(
          readFileSync(join(ctx.repoRoot, "config", "midgard-compatibility.json"), "utf8"),
        );
      } catch {
        return skip("config/midgard-compatibility.json is not readable");
      }
      const verified = config.midgard?.verifiedAgainst ?? null;
      const commit = config.midgard?.commit ?? null;
      const branch = config.midgard?.branch ?? "(no branch recorded)";
      const short = (value) => String(value).slice(0, 12);

      // The manifest identifies the deployment, and it is the only identity
      // here that can be compared against something running. So it is compared
      // rather than reported.
      const path = backendEnv(ctx)?.get("MIDGARD_MANIFEST_PATH") ?? "";
      let live = null;
      if (path !== "" && existsSync(path)) {
        try {
          live = JSON.parse(readFileSync(path, "utf8"))?.manifestId ?? null;
        } catch {
          live = null;
        }
      }

      if (verified?.manifestId === undefined) {
        return warn(
          "no deployment is recorded as verified",
          "Record midgard.verifiedAgainst in config/midgard-compatibility.json",
        );
      }
      if (live !== null && live !== verified.manifestId) {
        return warn(
          `a different deployment from the verified one: ${short(live)} against ${short(verified.manifestId)}`,
          "Not a fault. It means this build's verification does not cover the deployment being read",
        );
      }
      // A branch is a moving pointer, so recording only the branch says which
      // line of development this build reads and nothing about which revision
      // anybody checked. That stays a warning until somebody fills it.
      if (commit === null) {
        return warn(
          `deployment ${short(verified.manifestId)} matches, but the node build is not pinned: only branch ${branch}`,
          "Fill midgard.commit from the build record of the node being run. A local checkout is not evidence of what produced a deployment",
        );
      }
      return pass(`${branch} at ${short(commit)}, deployment ${short(verified.manifestId)}`);
    },
  },

  // --- readiness, read from the backend's own probe -------------------------
  {
    id: "readiness.node-database",
    title: "Node database relations",
    modes: REAL_DATA,
    run: readinessCheck("node database"),
  },
  {
    id: "readiness.explorer-index",
    title: "Index schema and migrations",
    modes: REAL_DATA,
    run: readinessCheck("explorer index"),
  },
  {
    id: "readiness.manifest",
    title: "Manifest parses",
    modes: REAL_DATA,
    run: readinessCheck("manifest", {
      outsideScope:
        "The manifest describes the L1 deployment. `/readyz` still refuses a process that cannot read it",
    }),
  },
  {
    id: "readiness.index-reconciled",
    title: "L1 index reconciled",
    modes: ["existing"],
    run: readinessCheck("index reconciled", {
      outsideScope:
        "L2 blocks and transactions do not wait on a reconciliation pass against Koios",
    }),
  },
  {
    id: "readiness.index-reconciled.full",
    title: "L1 index reconciled",
    modes: ["full"],
    run: readinessCheck("index reconciled"),
  },
];
