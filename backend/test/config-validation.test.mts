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
  KOIOS_BASE_URL: "https://preprod.koios.rest/api/v1",
  MIDGARD_MANIFEST_PATH: "./test/fixtures/manifest-sample.json",
  L1_SYNC_INTERVAL_MS: "60000",
  L1_REORG_LOOKBACK_BLOCKS: "20",
};

describe("parseConfig", () => {
  it("accepts a complete environment and returns numbers as numbers", () => {
    const c = parseConfig(valid);
    expect(c.BACKEND_PORT).toBe(3101);
    expect(c.L1_REORG_LOOKBACK_BLOCKS).toBe(20);
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

  it("rejects an empty string, which is not a configured value", () => {
    expect(() => parseConfig({ ...valid, KOIOS_BASE_URL: "" })).toThrow(
      /KOIOS_BASE_URL/,
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
        parseConfig({ ...valid, BACKEND_PORT: "no", KOIOS_BASE_URL: "" });
      } catch (e) {
        return String(e);
      }
      return "";
    })();
    expect(err).toMatch(/BACKEND_PORT/);
    expect(err).toMatch(/KOIOS_BASE_URL/);
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

  it("allows a reorg lookback of zero, which means scan from genesis", () => {
    expect(
      parseConfig({ ...valid, L1_REORG_LOOKBACK_BLOCKS: "0" })
        .L1_REORG_LOOKBACK_BLOCKS,
    ).toBe(0);
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

  /** One process must index. Two processes running the same sync loop against
   * one index duplicate every Koios request and race each other's writes, and
   * the moment a deployment runs more than one API instance that is the
   * default rather than an accident. */
  it("indexes by default, so a single-process deployment needs no new setting", () => {
    expect(parseConfig(valid).L1_SYNC_ENABLED).toBe(true);
  });

  it("lets an extra read-only instance opt out of indexing", () => {
    expect(parseConfig({ ...valid, L1_SYNC_ENABLED: "false" }).L1_SYNC_ENABLED).toBe(
      false,
    );
  });

  it("refuses a sync flag that is neither true nor false", () => {
    expect(() => parseConfig({ ...valid, L1_SYNC_ENABLED: "maybe" })).toThrow(
      /L1_SYNC_ENABLED/,
    );
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
    it("is required when the indexer runs", () => {
      const { MIDGARD_MANIFEST_PATH: _omitted, ...rest } = valid;
      expect(() => parseConfig({ ...rest, L1_SYNC_ENABLED: "true" })).toThrow(
        /MIDGARD_MANIFEST_PATH/,
      );
    });

    it("must name a readable file when the indexer runs", () => {
      expect(() =>
        parseConfig({
          ...valid,
          L1_SYNC_ENABLED: "true",
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
