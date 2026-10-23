// Tests and the dev server used to share one database, so `pnpm test` deleted
// real indexed data. This runs before any test module is imported, which is
// also before src/config.ts reads process.env, so the override is seen by the
// Prisma client that src/indexer/db.ts builds at import time.
//
// src/config.ts is normally what loads .env (via dotenv + dotenv-expand), but
// it hasn't been imported yet at this point in the vitest lifecycle. Load it
// here too so TEST_INDEXER_POSTGRES_URL is populated before the guard below
// reads it; dotenv's default `override: false` means this is a no-op if the
// variable was already provided by the shell.
import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";

expand(dotenv.config());

/** A typo here would silently point the suite at real data, so require the
 * database name to say so. This is the last line of defence before a
 * destructive test run.
 *
 * The check parses the URL and inspects only the path segment (the database
 * name), never the whole string. A substring/regex search over the full URL
 * is bypassable by anything downstream of the path -- a query string like
 * `?schema=explorer_test` reads as "ends in _test" to a naive regex while
 * naming the real database in the path. Exported so the test suite can
 * exercise this exact function rather than a re-implementation of it.
 */
export function assertTestDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `TEST_INDEXER_POSTGRES_URL is not a valid URL, got: ${url}`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, "").replace(/\/$/, "");

  if (!dbName.endsWith("_test")) {
    throw new Error(
      `TEST_INDEXER_POSTGRES_URL must name a database ending in _test, got: ${url}`,
    );
  }
}

const url = process.env.TEST_INDEXER_POSTGRES_URL;

if (!url) {
  throw new Error(
    "TEST_INDEXER_POSTGRES_URL is not set. Tests write to this database and " +
      "will truncate it. Point it at midgard_explorer_test, never at the " +
      "database the dev server uses.",
  );
}

assertTestDatabaseUrl(url);

process.env.INDEXER_POSTGRES_URL = url;
