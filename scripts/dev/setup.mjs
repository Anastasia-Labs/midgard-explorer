#!/usr/bin/env node
/**
 * `dev setup`: one local configuration, and the files every service reads
 * generated from it.
 *
 * Ports, origins, database URLs and the local database password are written
 * once into .dev/runtime.env. Nothing is copied by hand between Compose, the
 * backend and the frontend, so the three cannot disagree about which database
 * they are talking to or what its password is.
 *
 * What this writes, and nothing else:
 *   .dev/runtime.env                 the source, mode 0600
 *   backend/.env                     generated, only when absent or --force
 *   frontend-new/app/.env.local      generated, only when absent or --force
 *
 * It never deletes. A file replaced under --force is copied to <name>.backup
 * first. It never migrates a database it does not own: `setup test` refuses any
 * target whose name does not end in _test or whose host is not this machine.
 *
 * Usage: setup.mjs <repoRoot> <demo|existing|test> [--force] [--allow-remote]
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  RUNTIME_LINKS,
  backendSettings,
  expand,
  parseEnvFile,
  redact,
  urlTarget,
} from "./env.mjs";

const run = promisify(execFile);

const args = process.argv.slice(2);
const repoRoot = args.shift();
const mode = args.find((a) => !a.startsWith("-"));
const force = args.includes("--force");
const allowRemote = args.includes("--allow-remote");

const die = (message, hint) => {
  process.stderr.write(`${message}\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.exit(1);
};

if (!repoRoot) die("setup.mjs needs the repository root");
if (!["demo", "existing", "test"].includes(mode ?? "")) {
  die(`Unknown setup target: ${mode ?? "(none)"}`, "Use: ./dev setup demo|existing|test");
}

const say = (text) => process.stdout.write(`${text}\n`);
const step = (text) => process.stdout.write(`\u001b[1m${text}\u001b[0m\n`);

const devDir = join(repoRoot, ".dev");
const runtimePath = join(devDir, "runtime.env");

/* Local by default. A development command that binds a database to every
 * interface has published it to the network the machine is on. */
const DEFAULTS = {
  EXPLORER_POSTGRES_USER: "explorer",
  EXPLORER_POSTGRES_PORT: "5435",
  EXPLORER_POSTGRES_DB: "midgard_explorer",
  BACKEND_PORT: "3101",
  API_CACHE_PORT: "3102",
  FRONTEND_PORT: "3011",
  BIND_HOST: "127.0.0.1",
  KOIOS_BASE_URL: "https://preprod.koios.rest/api/v1",
  L1_SYNC_INTERVAL_MS: "60000",
  L1_REORG_LOOKBACK_BLOCKS: "20",
};

const readEnv = (path) => {
  const parsed = parseEnvFile(path);
  return parsed === null ? null : expand(parsed);
};

const writeSecret = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
};

/* An index that already works is described, not redefined.
 *
 * Regenerating a password that an existing PostgreSQL volume was initialised
 * with locks the database out of every client, and the volume is the thing that
 * cannot be regenerated. The host is carried for the same reason in a smaller
 * way: rewriting a working `localhost` as `127.0.0.1` names the same machine
 * but reads as configuration drift on every later run. */
const carriedIndex = () => {
  for (const [source, path] of [
    [".dev/runtime.env", runtimePath],
    ["backend/.env", join(repoRoot, "backend", ".env")],
  ]) {
    const url = readEnv(path)?.get("INDEXER_POSTGRES_URL");
    if (!url) continue;
    try {
      const parsed = new URL(url);
      const password = decodeURIComponent(parsed.password);
      if (!password) continue;
      return {
        from: source,
        password,
        user: decodeURIComponent(parsed.username) || undefined,
        host: parsed.hostname || undefined,
        port: parsed.port || undefined,
        database: parsed.pathname.slice(1) || undefined,
      };
    } catch {
      // Not a URL. Try the next source, then generate.
    }
  }
  return { from: "generated", password: randomBytes(24).toString("base64url") };
};

const buildRuntime = () => {
  const previous = readEnv(runtimePath) ?? new Map();
  const backend = readEnv(join(repoRoot, "backend", ".env"));
  const index = carriedIndex();

  // Settings a person set stay set. Setup fills what is missing rather than
  // asserting its own answer over one that is already working.
  const keep = (key, fallback) => previous.get(key) ?? fallback;

  const values = new Map();
  values.set("DEV_MODE", mode === "test" ? keep("DEV_MODE", "existing") : mode);
  for (const [key, fallback] of Object.entries(DEFAULTS)) values.set(key, keep(key, fallback));
  values.set("EXPLORER_POSTGRES_PASSWORD", index.password);
  if (index.user) values.set("EXPLORER_POSTGRES_USER", keep("EXPLORER_POSTGRES_USER", index.user));
  if (index.port) values.set("EXPLORER_POSTGRES_PORT", keep("EXPLORER_POSTGRES_PORT", index.port));
  if (index.database) {
    values.set("EXPLORER_POSTGRES_DB", keep("EXPLORER_POSTGRES_DB", index.database));
  }
  const indexHost = keep("EXPLORER_POSTGRES_HOST", index.host ?? values.get("BIND_HOST"));
  values.set("EXPLORER_POSTGRES_HOST", indexHost);

  const user = values.get("EXPLORER_POSTGRES_USER");
  const port = values.get("EXPLORER_POSTGRES_PORT");
  const db = values.get("EXPLORER_POSTGRES_DB");
  const host = indexHost;
  const encoded = encodeURIComponent(index.password);

  values.set("INDEXER_POSTGRES_URL", `postgresql://${user}:${encoded}@${host}:${port}/${db}`);
  values.set("TEST_INDEXER_POSTGRES_URL", `postgresql://${user}:${encoded}@${host}:${port}/${db}_test`);
  const bind = values.get("BIND_HOST");
  values.set("API_CACHE_URL", `http://${bind}:${values.get("API_CACHE_PORT")}`);
  values.set("BACKEND_URL", `http://${bind}:${values.get("BACKEND_PORT")}`);
  values.set("FRONTEND_URL", `http://${bind}:${values.get("FRONTEND_PORT")}`);
  values.set(
    "MIDGARD_MANIFEST_PATH",
    keep("MIDGARD_MANIFEST_PATH", backend?.get("MIDGARD_MANIFEST_PATH") ?? ""),
  );
  // The node's own database is not something setup can invent. It is carried
  // from backend/.env when that exists, and left blank to be filled otherwise.
  for (const key of ["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) {
    values.set(key, keep(key, backend?.get(key) ?? ""));
  }
  return { values, passwordFrom: index.from };
};

const serialise = (values, header) => {
  const lines = [header, ""];
  for (const [key, value] of values) lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
};

/* The settings `dev` owns, and the only ones it reports drift on.
 *
 * Pagination limits, log locations and whether the indexer runs are a person's
 * tuning of their own machine. Reporting those as drift trains the reader to
 * ignore the report, and the settings that matter are the ones that decide
 * which database and which origin a service talks to. */
const OWNED = Object.fromEntries(
  [...new Set(RUNTIME_LINKS.map((l) => l.file))].map((file) => [
    file,
    RUNTIME_LINKS.filter((l) => l.file === file).map((l) => l.key),
  ]),
);

/** Writes a generated file, or reports the drift when one already exists. */
const emit = (path, body, label) => {
  if (existsSync(path) && !force) {
    // Both sides expanded before comparing. The shipped backend/.env composes
    // its URLs out of ${PARTS}, so a textual comparison reports every composed
    // setting as different from the identical value written literally.
    const parsed = parseEnvFile(path);
    const current = parsed === null ? new Map() : expand(parsed);
    const desired = expand(
      new Map(
        body
          .split("\n")
          .filter((l) => l.includes("=") && !l.startsWith("#"))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      ),
    );
    const owned = OWNED[label] ?? [...desired.keys()];
    const drift = [...desired.entries()].filter(
      ([key, value]) => owned.includes(key) && (current.get(key) ?? "") !== value && value !== "",
    );
    if (drift.length === 0) {
      say(`  ${label} already agrees with .dev/runtime.env`);
      return "agrees";
    }
    say(`  ${label} exists and differs in ${drift.length} setting(s): ${drift.map(([k]) => k).join(", ")}`);
    say(`  Left as it is. To regenerate it from .dev/runtime.env: ./dev setup ${mode} --force`);
    return "differs";
  }
  if (existsSync(path)) {
    copyFileSync(path, `${path}.backup`);
    say(`  ${label} copied to ${label}.backup`);
  }
  writeSecret(path, body);
  say(`  ${label} written`);
  return "written";
};

const installFrontend = async () => {
  if (
    existsSync(join(repoRoot, "frontend-new", "node_modules")) &&
    existsSync(join(repoRoot, "frontend-new", "app", "node_modules"))
  ) {
    say("  frontend-new dependencies already installed");
    return;
  }
  step("Installing frontend-new dependencies");
  await run("pnpm", ["install", "--frozen-lockfile"], {
    cwd: join(repoRoot, "frontend-new"),
    timeout: 600_000,
  });
  say("  installed");
};

// --- setup test -------------------------------------------------------------

/** The guard on every write `setup test` makes.
 *
 * Two independent conditions, because either alone has a plausible way to be
 * satisfied by a database nobody meant to hand over: a local host can still
 * hold the real index, and a name ending in _test can still live on a server. */
const assertDisposable = (url) => {
  const target = urlTarget(url);
  if (target === null) die("TEST_INDEXER_POSTGRES_URL is not a URL", "Check .dev/runtime.env");
  if (!target.database.endsWith("_test")) {
    die(
      `Refusing to touch "${target.database}": the name does not end in _test.`,
      "The suite truncates this database. Only a database named for that is acceptable.",
    );
  }
  const local = ["127.0.0.1", "localhost", "::1"].includes(target.host);
  if (!local && !allowRemote) {
    die(
      `Refusing to touch ${target.host}: it is not this machine.`,
      "Pass --allow-remote only if you are certain the target is disposable.",
    );
  }
  return target;
};

const pgClient = () => {
  const require = createRequire(join(repoRoot, "backend", "package.json"));
  try {
    return require("pg");
  } catch {
    die(
      "The backend's PostgreSQL client is not installed.",
      "Run: cd backend && pnpm install",
    );
  }
};

const setupTest = async () => {
  const runtime = readEnv(runtimePath);
  if (runtime === null) die("No .dev/runtime.env.", "Run: ./dev setup existing");
  const url = runtime.get("TEST_INDEXER_POSTGRES_URL") ?? "";
  const target = assertDisposable(url);

  step(`Preparing the test index database: ${target.database}`);
  const { Client } = pgClient();
  const admin = new Client({ connectionString: url.replace(/\/[^/]+$/, "/postgres") });
  try {
    await admin.connect();
  } catch (error) {
    die(
      `Could not reach ${target.host}:${target.port}: ${redact(String(error?.message ?? error))}`,
      "Start it: docker compose --env-file .dev/runtime.env up -d explorer-postgres",
    );
  }
  const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    target.database,
  ]);
  if (rows.length === 0) {
    // Identifier, not a value, so it cannot be parameterised. The name reached
    // here only through assertDisposable, and is quoted on the way in.
    await admin.query(`CREATE DATABASE "${target.database.replace(/"/g, '""')}"`);
    say(`  created ${target.database}`);
  } else {
    say(`  ${target.database} already exists`);
  }
  await admin.end();

  step("Applying the index migrations to it");
  const { stdout } = await run("pnpm", ["indexer:deploy"], {
    cwd: join(repoRoot, "backend"),
    timeout: 300_000,
    env: { ...process.env, INDEXER_POSTGRES_URL: url },
  });
  const applied = stdout.match(/(\d+) migrations? (?:found|applied)/g) ?? [];
  say(`  ${applied.length > 0 ? applied.join("; ") : "migrations up to date"}`);
  say("");
  say("The backend test suite truncates this database and no other.");
};

// --- main -------------------------------------------------------------------

mkdirSync(devDir, { recursive: true });

if (mode === "test") {
  await setupTest();
} else if (mode === "demo") {
  step("Setting up demo mode");
  await installFrontend();
  say("");
  say("Demo mode reads no configuration: it passes the fixture's address to the app");
  say("directly. Start it with: ./dev up demo");
} else {
  step("Writing .dev/runtime.env");
  const { values, passwordFrom } = buildRuntime();
  writeSecret(
    runtimePath,
    serialise(
      values,
      "# Generated by `./dev setup`. The one place ports, origins, database URLs\n" +
        "# and the local database password are written. Edit here, then re-run\n" +
        "# `./dev setup existing --force` to regenerate the files below it.",
    ),
  );
  say(`  written, mode 0600, explorer password ${passwordFrom}`);

  step("Generating the files each service reads");
  const backendBody = serialise(
    backendSettings(values),
    "# Generated from .dev/runtime.env by `./dev setup`. Change values there.",
  );
  emit(join(repoRoot, "backend", ".env"), backendBody, "backend/.env");

  const frontendBody = serialise(
    new Map([
      ["NEXT_PUBLIC_API_BASE", values.get("API_CACHE_URL")],
      ["API_BASE_SERVER", values.get("API_CACHE_URL")],
      ["NEXT_PUBLIC_NETWORK_LABEL", "Preprod"],
      ["NEXT_PUBLIC_L1_EXPLORER_NAME", "CExplorer"],
      ["NEXT_PUBLIC_L1_EXPLORER_TX_URL", "https://preprod.cexplorer.io/tx/{hash}"],
      ["NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL", "https://preprod.cexplorer.io/address/{address}"],
    ]),
    "# Generated from .dev/runtime.env by `./dev setup`. Change values there.",
  );
  emit(join(repoRoot, "frontend-new", "app", ".env.local"), frontendBody, "frontend-new/app/.env.local");

  await installFrontend();

  say("");
  say(`Explorer will serve on  ${values.get("FRONTEND_URL")}`);
  say(`API through the cache   ${values.get("API_CACHE_URL")}`);
  say(`Explorer index          ${redact(values.get("INDEXER_POSTGRES_URL"))}`);
  // Carrying a URL forward is not the same as owning what it names. `./dev up
  // existing` migrates only the database this repository's Compose file
  // provisions, and says so there; saying it here too means the reader learns
  // it while configuring rather than while being refused.
  const carried = urlTarget(values.get("INDEXER_POSTGRES_URL") ?? "");
  const ownHost = ["127.0.0.1", "localhost", "::1"].includes(carried?.host ?? "");
  const ownName = carried?.database === values.get("EXPLORER_POSTGRES_DB");
  if (carried !== null && !(ownHost && ownName)) {
    say("");
    say("That index is not one this repository provisions, so `./dev up existing` will");
    say("not migrate it. Apply migrations through: cd backend && ./scripts/rollout.sh --apply");
  }
  if ((values.get("POSTGRES_HOST") ?? "") === "") {
    say("");
    say("The Midgard node's own database is not set. Fill POSTGRES_* in .dev/runtime.env,");
    say("then run: ./dev setup existing --force");
  }
  say("");
  say("Then: ./dev setup test    (creates and migrates the disposable test database)");
}

const mode0600 = (path) => {
  try {
    return (statSync(path).mode & 0o777) === 0o600;
  } catch {
    return true;
  }
};
if (!mode0600(runtimePath)) process.exitCode = 1;
