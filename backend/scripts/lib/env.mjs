/**
 * Reading and redacting local configuration.
 *
 * Nothing here writes a file: `doctor` is read-only, and the generator that
 * PR 4 adds will import the same parser so both read a `.env` the same way.
 *
 * Redaction is applied at the boundary rather than left to each caller. A
 * diagnostic that prints one connection string in full has leaked a password
 * into a terminal, a screenshot, or a pasted issue, and the caller who forgot
 * is the normal case rather than the exception.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Keys whose value is never printed, whatever it holds. */
const SECRET_KEY = /(PASSWORD|SECRET|SEED|TOKEN|PRIVATE|APIKEY|API_KEY)/i;

/** Placeholders the shipped examples carry. A value still equal to one of these
 * means the file was copied and not filled in, which reads as "configured" to
 * anything that only checks for a non-empty string. */
export const PLACEHOLDERS = [
  "CHANGEME",
  "/abs/path/to/contract-deployment-info.json",
  "changeme",
  "your-password-here",
];

/** Parses KEY=VALUE lines. Not a shell: nothing is executed, and a line that is
 * not an assignment is skipped rather than guessed at. */
export const parseEnvFile = (path) => {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const values = new Map();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
};

/** Resolves `${NAME}` against the same file, which is how the shipped
 * `.env.example` composes POSTGRES_URL out of its parts. */
export const expand = (values) => {
  const resolved = new Map(values);
  for (const [key, value] of values) {
    resolved.set(
      key,
      value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) =>
        values.has(name) ? values.get(name) : whole,
      ),
    );
  }
  return resolved;
};

/** Replaces the password in any URL, wherever the string came from. */
export const redact = (text) =>
  String(text).replace(
    /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/g,
    (whole, scheme, user) => `${scheme}${user}:***@`,
  );

/** What may be shown for one setting. */
export const redactValue = (key, value) => (SECRET_KEY.test(key) ? "***" : redact(value));

/** Host and port of a PostgreSQL URL, without its credentials. */
export const urlTarget = (value) => {
  try {
    const url = new URL(value);
    return { host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) };
  } catch {
    return null;
  }
};

export const isPlaceholder = (value) =>
  value !== undefined && PLACEHOLDERS.some((p) => value.includes(p));

/**
 * Which generated setting is filled from which key of .dev/runtime.env.
 *
 * One list, read by the generator that writes these files and by the check that
 * reports when they have drifted apart. Two lists would be two answers to the
 * question of what "in sync" means.
 */
export const RUNTIME_LINKS = [
  { file: "backend/.env", key: "INDEXER_POSTGRES_URL", runtime: "INDEXER_POSTGRES_URL" },
  { file: "backend/.env", key: "TEST_INDEXER_POSTGRES_URL", runtime: "TEST_INDEXER_POSTGRES_URL" },
  { file: "backend/.env", key: "MIDGARD_MANIFEST_PATH", runtime: "MIDGARD_MANIFEST_PATH" },
  { file: "backend/.env", key: "BACKEND_PORT", runtime: "BACKEND_PORT" },
  { file: "frontend-new/app/.env.local", key: "NEXT_PUBLIC_API_BASE", runtime: "API_CACHE_URL" },
  { file: "frontend-new/app/.env.local", key: "API_BASE_SERVER", runtime: "API_CACHE_URL" },
];

/** The generated files, in the order a reader meets them. */
export const GENERATED_FILES = [...new Set(RUNTIME_LINKS.map((l) => l.file))];

/** Everything the generated backend/.env carries.
 *
 * Exported so the doctor check that names the required settings can be tested
 * against it. The two lists went out of step once already: the backend declared
 * L1_SYNC_INTERVAL_MS and L1_REORG_LOOKBACK_BLOCKS with no default, setup wrote
 * neither, and doctor asked for neither, so a clean setup produced a
 * configuration that reported Ready and then refused to boot. */
export const backendSettings = (values) =>
  new Map([
    ["LOG_LOCATION", "./logs/midgard-explorer-backend"],
    ["BACKEND_PORT", values.get("BACKEND_PORT")],
    ["POSTGRES_HOST", values.get("POSTGRES_HOST")],
    ["POSTGRES_PORT", values.get("POSTGRES_PORT")],
    ["POSTGRES_USER", values.get("POSTGRES_USER")],
    ["POSTGRES_PASSWORD", values.get("POSTGRES_PASSWORD")],
    ["POSTGRES_DB", values.get("POSTGRES_DB")],
    [
      "POSTGRES_URL",
      "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public",
    ],
    ["INDEXER_POSTGRES_URL", values.get("INDEXER_POSTGRES_URL")],
    ["TEST_INDEXER_POSTGRES_URL", values.get("TEST_INDEXER_POSTGRES_URL")],
    ["MIDGARD_MANIFEST_PATH", values.get("MIDGARD_MANIFEST_PATH")],
    ["KOIOS_BASE_URL", values.get("KOIOS_BASE_URL")],
    ["RECENT_BLOCKS_LIMIT", "10"],
    ["RECENT_TRANSACTIONS_LIMIT", "10"],
    ["TRANSACTIONS_PER_PAGE", "25"],
    ["BLOCKS_PER_PAGE", "25"],
    ["L1_SYNC_ENABLED", "false"],
    ["L1_SYNC_INTERVAL_MS", values.get("L1_SYNC_INTERVAL_MS")],
    ["L1_REORG_LOOKBACK_BLOCKS", values.get("L1_REORG_LOOKBACK_BLOCKS")],
  ]);

/**
 * The settings `dev up existing` may read out of .dev/runtime.env.
 *
 * .dev/runtime.env is a dotenv file, written by a generator that quotes
 * nothing. `source`-ing it made every value shell code: a password carried
 * from a person's own backend/.env, or a manifest path with a space in it,
 * would be word-split, glob-expanded, or executed as a command substitution by
 * the shell that was only trying to learn a port number.
 *
 * So the shell never reads the file. This list is what it may learn, each value
 * is validated here, and the emitter below quotes what it prints. Anything not
 * named here does not reach the shell at all, which is why
 * EXPLORER_POSTGRES_PASSWORD is absent: Compose reads it through --env-file and
 * the backend reads it from its own .env, so no `dev` shell needs to hold it.
 */
export const RUNTIME_SHELL_KEYS = [
  { key: "BACKEND_PORT", kind: "port", required: true },
  { key: "API_CACHE_PORT", kind: "port", required: true },
  { key: "FRONTEND_PORT", kind: "port", required: true },
  { key: "BIND_HOST", kind: "host", required: false },
  { key: "EXPLORER_POSTGRES_HOST", kind: "host", required: false },
  { key: "EXPLORER_POSTGRES_PORT", kind: "port", required: false },
  { key: "EXPLORER_POSTGRES_USER", kind: "text", required: false },
  { key: "EXPLORER_POSTGRES_DB", kind: "text", required: false },
  { key: "MIDGARD_MANIFEST_PATH", kind: "text", required: false },
  { key: "KOIOS_BASE_URL", kind: "text", required: false },
];

/** Where the index URL points, without the credential that reaches it.
 *
 * Emitted as four separate values so the shell compares strings rather than
 * parsing a URL, and so the password never enters a process environment that
 * only needed to know which database was about to be migrated. */
export const INDEX_TARGET_KEYS = [
  "INDEX_URL_HOST",
  "INDEX_URL_PORT",
  "INDEX_URL_USER",
  "INDEX_URL_DB",
];

/**
 * The index URL the backend and `prisma migrate deploy` will actually use.
 *
 * Not .dev/runtime.env. `prisma.indexer.config.ts` runs `dotenv.config()` from
 * the backend directory and reads INDEXER_POSTGRES_URL, and dotenv leaves an
 * existing non-empty process variable alone, so the effective target is the
 * process environment first and backend/.env second. A guard that read
 * runtime.env instead was checking a value nothing migrates against: a local
 * runtime.env beside a remote backend/.env passed it, and the remote database
 * was the one that got migrated.
 */
export const effectiveIndexUrl = ({ processEnv = {}, backendEnv, runtime }) => {
  const fromProcess = processEnv.INDEXER_POSTGRES_URL ?? "";
  if (fromProcess !== "") {
    return { url: fromProcess, source: "the INDEXER_POSTGRES_URL in this environment" };
  }
  const fromBackend = backendEnv?.get("INDEXER_POSTGRES_URL") ?? "";
  if (fromBackend !== "") return { url: fromBackend, source: "backend/.env" };
  const fromRuntime = runtime?.get("INDEXER_POSTGRES_URL") ?? "";
  if (fromRuntime !== "") return { url: fromRuntime, source: ".dev/runtime.env" };
  return { url: "", source: "nowhere" };
};

/** A host name or an address, IPv6 included: `::1` is where a local database
 * lives on plenty of machines, and rejecting it made a working configuration
 * unreadable. */
const HOST = /^[A-Za-z0-9._:-]+$/;

/** A port, in the range that exists. `\d{1,5}` also matched 99999. */
const isPort = (value) => /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;

/** POSIX single-quoting: the only form with no escape sequences at all, so a
 * value cannot end the quote and start a command. */
const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/**
 * The whitelisted settings, validated, as shell assignments.
 *
 * Returns { lines, errors }. A caller with any error prints them and stops:
 * a port that is not a number is a configuration mistake, and continuing with
 * it produces a service listening somewhere nobody asked for.
 */
export const runtimeShellValues = (runtime, { backendEnv, processEnv } = {}) => {
  const errors = [];
  const out = new Map();

  for (const { key, kind, required } of RUNTIME_SHELL_KEYS) {
    const value = runtime.get(key) ?? "";
    if (value === "") {
      if (required) errors.push(`${key} is missing from .dev/runtime.env`);
      continue;
    }
    if (kind === "port" && !isPort(value)) {
      errors.push(`${key} is "${value}", which is not a port number`);
      continue;
    }
    if (kind === "host" && !HOST.test(value)) {
      errors.push(`${key} is "${value}", which is not a host name`);
      continue;
    }
    out.set(key, value);
  }

  const { url, source } = effectiveIndexUrl({ processEnv, backendEnv, runtime });
  if (url === "") {
    errors.push("INDEXER_POSTGRES_URL is set nowhere the backend reads");
  } else {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      errors.push(`INDEXER_POSTGRES_URL in ${source} is not a URL`);
    }
    if (parsed) {
      out.set("INDEX_URL_HOST", parsed.hostname);
      out.set("INDEX_URL_PORT", parsed.port || "5432");
      out.set("INDEX_URL_USER", decodeURIComponent(parsed.username));
      out.set("INDEX_URL_DB", parsed.pathname.slice(1));
      out.set("INDEX_URL_SOURCE", source);
    }
  }

  return {
    errors,
    lines: [...out].map(([key, value]) => `${key}=${shellQuote(value)}`),
  };
};

// --- command line -----------------------------------------------------------

/* Imported by doctor, setup and the tests. The block below runs only when this
 * file is the entry point, so an import does not fall through to it. */
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const [, , command, path] = process.argv;
  if (command !== "shell" || path === undefined) {
    process.stderr.write(
      "Usage: env.mjs shell <path to .dev/runtime.env> [path to backend/.env]\n",
    );
    process.exit(2);
  }
  const parsed = parseEnvFile(path);
  if (parsed === null) {
    process.stderr.write(`No file at ${path}\n`);
    process.exit(1);
  }
  // backend/.env sits beside it in the argument list, because the index the
  // backend connects to and the migration applies is the one named there.
  const backendPath = process.argv[4];
  const backendParsed = backendPath === undefined ? null : parseEnvFile(backendPath);
  const { errors, lines } = runtimeShellValues(expand(parsed), {
    backendEnv: backendParsed === null ? null : expand(backendParsed),
    processEnv: process.env,
  });
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.exit(1);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
