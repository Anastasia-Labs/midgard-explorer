#!/usr/bin/env node
/**
 * `pnpm setup`: one local configuration, and the files every service reads
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
 *
 * Nothing outside this package. The frontend needs no generated file: it
 * defaults to the port this backend serves on, and takes an override when one
 * is present.
 *
 * It never deletes. A file replaced under --force is copied to <name>.backup
 * first. It migrates nothing: the test suite creates and drops its own
 * throwaway databases, so there is no test database for setup to provision.
 *
 * Usage: setup.mjs <repoRoot> existing [--force]
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RUNTIME_LINKS, backendSettings, expand, parseEnvFile } from "./lib/env.mjs";

const args = process.argv.slice(2);
const repoRoot = args.shift();
const mode = args.find((a) => !a.startsWith("-"));
const force = args.includes("--force");

const die = (message, hint) => {
  process.stderr.write(`${message}\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.exit(1);
};

if (!repoRoot) die("setup.mjs needs the repository root");
if ((mode ?? "") !== "existing") {
  die(`Unknown setup target: ${mode ?? "(none)"}`, "Use: pnpm setup");
}

const say = (text) => process.stdout.write(`${text}\n`);
const step = (text) => process.stdout.write(`\u001b[1m${text}\u001b[0m\n`);

const devDir = join(repoRoot, ".dev");
const runtimePath = join(devDir, "runtime.env");

/* Local by default. A development command that binds a database to every
 * interface has published it to the network the machine is on. */
const DEFAULTS = {
  BACKEND_PORT: "3101",
  API_CACHE_PORT: "3102",
  FRONTEND_PORT: "3011",
  BIND_HOST: "127.0.0.1",
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

/* The retained explorer database's settings are carried, never regenerated.
 *
 * Nothing this repository runs reads that database: the Cardano index is
 * decommissioned and it is kept stopped, with its volume, so the decision can
 * be reversed. Reversing it needs the password the volume was initialised with,
 * and regenerating that locks the volume out of every client. So setup copies
 * forward whatever is already there and invents nothing.
 *
 * Absent, these are simply not written. A machine that never provisioned the
 * index has nothing to roll back to, and a generated password would only be a
 * credential for a database that does not exist. */
const RETAINED_KEYS = [
  "EXPLORER_POSTGRES_HOST",
  "EXPLORER_POSTGRES_PORT",
  "EXPLORER_POSTGRES_USER",
  "EXPLORER_POSTGRES_DB",
  "EXPLORER_POSTGRES_PASSWORD",
];

const buildRuntime = () => {
  const previous = readEnv(runtimePath) ?? new Map();
  const backend = readEnv(join(repoRoot, "backend", ".env"));

  // Settings a person set stay set. Setup fills what is missing rather than
  // asserting its own answer over one that is already working.
  //
  // An empty value is missing, not set. `??` treats "" as an answer, so a
  // runtime.env written before the node's database was known kept overwriting
  // the values a person had just filled into backend/.env: setup reported the
  // files agreed and asked for the same settings again.
  const keep = (key, fallback) => {
    const held = previous.get(key);
    return held === undefined || held === "" ? fallback : held;
  };

  const values = new Map();
  values.set("DEV_MODE", mode === "test" ? keep("DEV_MODE", "existing") : mode);
  for (const [key, fallback] of Object.entries(DEFAULTS)) values.set(key, keep(key, fallback));
  for (const key of RETAINED_KEYS) {
    const held = previous.get(key);
    if (held !== undefined && held !== "") values.set(key, held);
  }

  const bind = values.get("BIND_HOST");
  values.set("API_CACHE_URL", `http://${bind}:${values.get("API_CACHE_PORT")}`);
  values.set("BACKEND_URL", `http://${bind}:${values.get("BACKEND_PORT")}`);
  values.set("FRONTEND_URL", `http://${bind}:${values.get("FRONTEND_PORT")}`);
  // Compose interpolates these two. Without them the cache would proxy to its
  // own default port while the frontend was told another, which is the drift
  // this file exists to remove.
  values.set("BACKEND_ORIGIN", `host.docker.internal:${values.get("BACKEND_PORT")}`);
  values.set(
    "MIDGARD_MANIFEST_PATH",
    keep("MIDGARD_MANIFEST_PATH", backend?.get("MIDGARD_MANIFEST_PATH") ?? ""),
  );
  // The node's own database is not something setup can invent. It is carried
  // from backend/.env when that exists, and left blank to be filled otherwise.
  for (const key of ["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) {
    values.set(key, keep(key, backend?.get(key) ?? ""));
  }
  return { values, retained: RETAINED_KEYS.some((key) => values.has(key)) };
};

const serialise = (values, header) => {
  const lines = [header, ""];
  for (const [key, value] of values) lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
};

/* The settings `dev` owns, and the only ones it reports drift on.
 *
 * Pagination limits and log locations are a person's tuning of their own
 * machine. Reporting those as drift trains the reader to
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
    say("  Left as it is. To regenerate it from .dev/runtime.env: pnpm setup --force");
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

// --- main -------------------------------------------------------------------

mkdirSync(devDir, { recursive: true });

step("Writing .dev/runtime.env");
const { values, retained } = buildRuntime();
writeSecret(
  runtimePath,
  serialise(
    values,
    "# Generated by `pnpm setup`. The one place ports, origins and database URLs\n" +
      "# are written. Edit here, then re-run\n" +
      "# `pnpm setup --force` to regenerate the files below it.",
  ),
);
say(`  written, mode 0600${retained ? ", retained explorer database settings carried" : ""}`);

step("Generating the file this package reads");
const backendBody = serialise(
  backendSettings(values),
  "# Generated from .dev/runtime.env by `pnpm setup`. Change values there.",
);
emit(join(repoRoot, "backend", ".env"), backendBody, "backend/.env");

say("");
say(`Backend will serve on   ${values.get("BACKEND_URL")}`);
if ((values.get("POSTGRES_HOST") ?? "") === "") {
  say("");
  say("Still needed: the Midgard node's own database. Nothing here can invent it.");
  // backend/.env is what this package reads, so that is the file to edit.
  // Running setup again carries the values into .dev/runtime.env, which is
  // internal state rather than somewhere to type.
  say("  1. Fill POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD");
  say("     and POSTGRES_DB in backend/.env");
  say("  2. Run: pnpm setup");
  say("  3. Run: pnpm dev");
} else {
  say("");
  say("Start it with: pnpm dev");
}

const mode0600 = (path) => {
  try {
    return (statSync(path).mode & 0o777) === 0o600;
  } catch {
    return true;
  }
};
if (!mode0600(runtimePath)) process.exitCode = 1;
