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
