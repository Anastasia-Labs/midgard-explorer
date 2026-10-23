import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "./setup-indexer-db.mjs";

/**
 * `assertTestDatabaseUrl` is the last line of defence before a test run
 * truncates whatever database `TEST_INDEXER_POSTGRES_URL` points at. Each
 * case below is split out on its own so a failure names the exact shape that
 * broke, rather than reporting one generic "guard test failed."
 *
 * The query-string cases are the regression: an earlier version checked
 * `/_test(\?|$)/` against the whole connection string, which a query
 * parameter like `?schema=explorer_test` satisfies even though the actual
 * database in the URL path is not a `_test` database. This suite exercises
 * the exported function the setup file itself calls, not a re-implementation
 * of the check, so it proves what the setup file actually does.
 */
describe("assertTestDatabaseUrl", () => {
  it("rejects a plain dev URL", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://explorer:x@localhost:5435/midgard_explorer",
      ),
    ).toThrow(/must name a database ending in _test/);
  });

  it("accepts a _test URL", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://explorer:x@localhost:5435/midgard_explorer_test",
      ),
    ).not.toThrow();
  });

  it("rejects a dev URL whose query string value ends in _test (regression case)", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://explorer:x@localhost:5435/midgard_explorer?schema=explorer_test",
      ),
    ).toThrow(/must name a database ending in _test/);
  });

  it("accepts a _test URL with a query string", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://explorer:x@localhost:5435/midgard_explorer_test?schema=public",
      ),
    ).not.toThrow();
  });

  it("accepts a _test URL with a trailing slash", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://explorer:x@localhost:5435/midgard_explorer_test/",
      ),
    ).not.toThrow();
  });

  it("rejects a malformed URL with a clear error rather than an opaque TypeError", () => {
    expect(() => assertTestDatabaseUrl("not a url at all")).toThrow(
      /TEST_INDEXER_POSTGRES_URL is not a valid URL/,
    );
  });
});
