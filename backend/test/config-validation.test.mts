import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

/**
 * A boot that refuses is cheaper than a query that silently uses NaN. The
 * previous version cast required values with `as string` and ran
 * `Number(process.env.X)`, so a missing port became NaN and a missing URL
 * became undefined, both of them surfacing far from the cause.
 */

const valid = {
  BACKEND_PORT: "3101",
  POSTGRES_URL: "postgres://u:p@localhost:5433/midgard",
  REQUIRE_MIDGARD_READ_REPLICA: "false",
  NODE_DB_POOL_MAX: "8",
  INDEXER_DB_POOL_MAX: "5",
  DB_CONNECTION_TIMEOUT_MS: "5000",
  DB_IDLE_TIMEOUT_MS: "30000",
  DB_STATEMENT_TIMEOUT_MS: "10000",
  RESPONSE_CACHE_MAX_ENTRIES: "1000",
  API_RATE_LIMIT_MAX: "120",
  API_RATE_LIMIT_WINDOW_MS: "60000",
  LOG_LOCATION: "./logs",
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: "5433",
  POSTGRES_USER: "u",
  POSTGRES_PASSWORD: "p",
  POSTGRES_DB: "midgard",
  RECENT_BLOCKS_LIMIT: "10",
  RECENT_TRANSACTIONS_LIMIT: "10",
  TRANSACTIONS_PER_PAGE: "25",
  BLOCKS_PER_PAGE: "25",
  INDEXER_POSTGRES_URL: "postgres://u:p@localhost:5435/midgard_explorer",
  MIDGARD_MANIFEST_PATH: "./test/fixtures/manifest-sample.json",
};

describe("parseConfig", () => {
  it("accepts a complete environment and returns numbers as numbers", () => {
    const c = parseConfig(valid);
    expect(c.BACKEND_PORT).toBe(3101);
    expect(c.NODE_DB_POOL_MAX).toBe(8);
  });

  it("names the missing variable rather than yielding undefined", () => {
    const { POSTGRES_URL: _omitted, ...rest } = valid;
    expect(() => parseConfig(rest)).toThrow(/POSTGRES_URL/);
  });

  it("names a port that is not a number rather than yielding NaN", () => {
    expect(() => parseConfig({ ...valid, BACKEND_PORT: "no" })).toThrow(
      /BACKEND_PORT/,
    );
  });

  it("rejects a port of zero, which no server listens on", () => {
    expect(() => parseConfig({ ...valid, POSTGRES_PORT: "0" })).toThrow(
      /POSTGRES_PORT/,
    );
  });

  it("reports every bad variable at once, not one per restart", () => {
    const err = (() => {
      try {
        parseConfig({ ...valid, BACKEND_PORT: "no", NODE_DB_POOL_MAX: "no" });
      } catch (e) {
        return String(e);
      }
      return "";
    })();
    expect(err).toMatch(/BACKEND_PORT/);
    expect(err).toMatch(/NODE_DB_POOL_MAX/);
  });

  // Nothing reads these to connect: POSTGRES_URL is the only connection
  // setting. Requiring them refused a boot over five values the process never
  // looks at, so a deployment supplying a complete URL was rejected.
  it("boots on a connection URL alone", () => {
    const {
      POSTGRES_HOST: _h,
      POSTGRES_PORT: _p,
      POSTGRES_USER: _u,
      POSTGRES_PASSWORD: _pw,
      POSTGRES_DB: _db,
      ...rest
    } = valid;
    const parsed = parseConfig(rest);
    expect(parsed.POSTGRES_URL).toBe(valid.POSTGRES_URL);
    expect(parsed.POSTGRES_HOST).toBeUndefined();
  });

  it("still rejects a component that is set to nonsense", () => {
    expect(() => parseConfig({ ...valid, POSTGRES_PORT: "no" })).toThrow(
      /POSTGRES_PORT/,
    );
  });

  it("refuses to trust an edge without naming it", () => {
    expect(() =>
      parseConfig({ ...valid, TRUSTED_PROXY_MODE: "single-edge" }),
    ).toThrow(/TRUSTED_PROXY_PEERS/);
  });

  it("defaults to trusting no edge at all", () => {
    const parsed = parseConfig(valid);
    expect(parsed.TRUSTED_PROXY_MODE).toBe("none");
    expect(parsed.TRUSTED_PROXY_PEERS).toEqual([]);
  });

  it("accepts a named edge", () => {
    const parsed = parseConfig({
      ...valid,
      TRUSTED_PROXY_MODE: "single-edge",
      TRUSTED_PROXY_PEERS: "172.18.0.0/16, 10.0.0.5",
    });
    expect(parsed.TRUSTED_PROXY_PEERS).toEqual(["172.18.0.0/16", "10.0.0.5"]);
  });

  it("can require a replica in public production", () => {
    expect(() =>
      parseConfig({ ...valid, REQUIRE_MIDGARD_READ_REPLICA: "true" }),
    ).toThrow(/MIDGARD_READ_REPLICA_URL/);
    expect(
      parseConfig({
        ...valid,
        REQUIRE_MIDGARD_READ_REPLICA: "true",
        MIDGARD_READ_REPLICA_URL: "postgres://reader:p@replica:5432/midgard",
      }).MIDGARD_READ_REPLICA_URL,
    ).toContain("replica");
  });


  it("rejects an unbounded or nonsensical pool setting", () => {
    expect(() => parseConfig({ ...valid, NODE_DB_POOL_MAX: "0" })).toThrow(
      /NODE_DB_POOL_MAX/,
    );
  });

  /* The manifest names the L1 deployment, so it is required exactly where it is
   * read. An L2-only development instance never opens it and used to be refused
   * at boot; an indexing instance without it writes rows attributed to nothing. */
  describe("MIDGARD_MANIFEST_PATH", () => {
    /** Optional, and checked when it is there. An explorer with no manifest
     * serves Midgard figures it cannot attribute to a deployment, which
     * readiness refuses; a manifest naming no file is a configuration mistake
     * and is refused here. */
    it("is accepted when absent, because it is optional", () => {
      const { MIDGARD_MANIFEST_PATH: _omitted, ...rest } = valid;
      expect(parseConfig(rest).MIDGARD_MANIFEST_PATH).toBeUndefined();
    });

    it("must name a readable file when it is set", () => {
      expect(() =>
        parseConfig({
          ...valid,
          MIDGARD_MANIFEST_PATH: "/nonexistent/manifest.json",
        }),
      ).toThrow(/MIDGARD_MANIFEST_PATH/);
    });

    it("is optional when the instance serves reads only", () => {
      const { MIDGARD_MANIFEST_PATH: _omitted, ...rest } = valid;
      const parsed = parseConfig({ ...rest, L1_SYNC_ENABLED: "false" });
      expect(parsed.MIDGARD_MANIFEST_PATH).toBeUndefined();
    });

    it("reads an empty value as absent rather than as a path", () => {
      const parsed = parseConfig({
        ...valid,
        L1_SYNC_ENABLED: "false",
        MIDGARD_MANIFEST_PATH: "",
      });
      expect(parsed.MIDGARD_MANIFEST_PATH).toBeUndefined();
    });
  });
});
