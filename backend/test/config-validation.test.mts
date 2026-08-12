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
    expect(parseConfig({ ...valid, L1_REORG_LOOKBACK_BLOCKS: "0" })
      .L1_REORG_LOOKBACK_BLOCKS).toBe(0);
  });
});
