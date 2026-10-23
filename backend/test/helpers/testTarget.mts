import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";

/**
 * Which PostgreSQL server the suite may use, and which it must never use.
 *
 * `backend/.env` holds the application's credentials. On a developer machine
 * they name the live Midgard node's server, so the suite never loads that file
 * and never connects where it points. A test server is named explicitly, by
 * `TEST_POSTGRES_URL` or by the benchmark's own URL, and checked here before
 * any connection is made.
 *
 * The check compares configured host names, with loopback aliases treated as
 * one host. Two different names can still reach the same server, so this is a
 * second line of defence: naming a disposable server explicitly is the control.
 */

/** The application's own settings file. */
export const APPLICATION_ENV = fileURLToPath(new URL("../../.env", import.meta.url));

type Server = { host: string; port: number };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const serverOf = (url: string): Server => {
  const parsed = new URL(url);
  const host = LOOPBACK.has(parsed.hostname) ? "127.0.0.1" : parsed.hostname;
  return { host, port: parsed.port === "" ? 5432 : Number(parsed.port) };
};

/** A URL with its credentials removed, safe for an error message. */
const shown = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "(unparsable URL)";
  }
};

/**
 * The server the application's `.env` names, or null when there is no `.env`,
 * as in CI. Parsed and expanded into a private object: `process.env` is never
 * touched, so reading it cannot leak its values into the suite.
 */
export function applicationServer(path: string = APPLICATION_ENV): Server | null {
  if (!existsSync(path)) return null;
  const parsed = dotenv.parse(readFileSync(path));
  const { parsed: expanded } = expand({ parsed: { ...parsed }, processEnv: {} });
  const url = expanded?.POSTGRES_URL;
  if (url) return serverOf(url);
  if (expanded?.POSTGRES_HOST) {
    return serverOf(`postgresql://x@${expanded.POSTGRES_HOST}:${expanded.POSTGRES_PORT ?? 5432}/x`);
  }
  return null;
}

/** Throws unless `url` names a server other than the application's. */
export function assertDisposableServer(url: string, envPath: string = APPLICATION_ENV): void {
  const app = applicationServer(envPath);
  if (app === null) return;
  const target = serverOf(url);
  if (target.host === app.host && target.port === app.port) {
    throw new Error(
      `refusing to use ${shown(url)} for tests: it is the server the application's .env ` +
        `names (${app.host}:${app.port}). Point TEST_POSTGRES_URL at a disposable server.`,
    );
  }
}
