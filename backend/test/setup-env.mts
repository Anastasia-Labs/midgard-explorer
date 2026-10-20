// The suite's environment, set before any test module is imported.
//
// The suite never reads the application's `.env`: on a developer machine it
// holds the live Midgard node's credentials, so a local run read the live node
// database, and the throwaway harness would have created its databases on that
// server had a database test been enabled. `EXPLORER_DOTENV=off` stops
// `src/config.ts` from loading it, and the database comes only from
// `TEST_POSTGRES_URL`, checked against the application's `.env` first.
//
// With no test server named, the suite runs against an address nothing listens
// on: tests that need a database skip, and fail under REQUIRE_DB=1.
import { assertDisposableServer } from "./helpers/testTarget.mjs";

process.env.EXPLORER_DOTENV = "off";

const UNCONFIGURED = "postgresql://test-database-not-configured@127.0.0.1:1/none";
const target = process.env.TEST_POSTGRES_URL || UNCONFIGURED;
assertDisposableServer(target);

const url = new URL(target);
process.env.POSTGRES_URL = target;
process.env.POSTGRES_HOST = url.hostname;
process.env.POSTGRES_PORT = url.port || "5432";
process.env.POSTGRES_USER = decodeURIComponent(url.username);
process.env.POSTGRES_PASSWORD = decodeURIComponent(url.password);
process.env.POSTGRES_DB = url.pathname.slice(1);

// The settings `src/config.ts` requires, for a suite that loads no `.env`.
const defaults: Record<string, string> = {
  BACKEND_PORT: "3101",
  LOG_LOCATION: "./logs/test",
  RECENT_BLOCKS_LIMIT: "10",
  RECENT_TRANSACTIONS_LIMIT: "10",
  TRANSACTIONS_PER_PAGE: "25",
  BLOCKS_PER_PAGE: "25",
  MIDGARD_MANIFEST_PATH: "./test/fixtures/manifest-sample.json",
};
for (const [name, value] of Object.entries(defaults)) {
  if (!process.env[name]) process.env[name] = value;
}
