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
  NODE_RPC_HOST: "localhost",
  NODE_RPC_PORT: "3000",
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
  MIDGARD_MANIFEST_PATH: "./manifest.json",
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

  // Nothing calls the node over HTTP, so no deployment sets these. Requiring
  // them would refuse a boot over settings no code path reads.
  it("boots without the unused node RPC settings", () => {
    const { NODE_RPC_HOST: _h, NODE_RPC_PORT: _p, ...rest } = valid;
    expect(parseConfig(rest).NODE_RPC_HOST).toBeUndefined();
  });

  it("still rejects a node RPC port that is set to nonsense", () => {
    expect(() => parseConfig({ ...valid, NODE_RPC_PORT: "no" })).toThrow(
      /NODE_RPC_PORT/,
    );
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
});
