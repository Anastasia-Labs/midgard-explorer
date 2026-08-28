import { describe, expect, it } from "vitest";
import { boundedPoolConfig } from "../src/db/pool.js";

describe("bounded PostgreSQL pools", () => {
  it("bounds connections and both client and server query time", () => {
    const pool = boundedPoolConfig({
      connectionString: "postgres://reader:secret@replica/midgard",
      max: 8,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 30_000,
      statementTimeoutMs: 10_000,
      applicationName: "test-reader",
      readOnly: true,
    });
    expect(pool).toMatchObject({
      max: 8,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      query_timeout: 11_000,
      application_name: "test-reader",
      options: "-c default_transaction_read_only=on",
    });
  });

  it("does not make the explorer-owned index database read-only", () => {
    const pool = boundedPoolConfig({
      connectionString: "postgres://explorer:secret@indexer/explorer",
      max: 5,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 30_000,
      statementTimeoutMs: 10_000,
      applicationName: "test-indexer",
    });
    expect(pool.options).toBeUndefined();
  });
});
