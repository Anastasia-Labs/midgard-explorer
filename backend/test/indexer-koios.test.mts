import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAddressTxs, parseTxInfo } from "../src/indexer/koios.js";

/**
 * Parsing is tested against fixtures captured from the live API, never against
 * the network: CI has no outbound access and a test that silently depends on a
 * third party is a flake waiting to happen.
 */

const load = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/koios/${name}`, import.meta.url), "utf8"),
  );

describe("parseAddressTxs", () => {
  it("parses the state queue address history", () => {
    const rows = parseAddressTxs(load("address-txs.json"));
    expect(rows).toHaveLength(7);
    expect(rows[0].tx_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].block_height).toBeGreaterThan(4900000);
  });

  it("rejects a payload missing required fields", () => {
    expect(() => parseAddressTxs([{ tx_hash: "abc" }])).toThrow();
  });

  it("rejects a non-array payload", () => {
    expect(() => parseAddressTxs({ error: "rate limited" })).toThrow();
  });
});

describe("parseTxInfo", () => {
  const infos = parseTxInfo(load("tx-info-state-queue.json"));

  it("parses one transaction with its outputs", () => {
    expect(infos).toHaveLength(1);
    expect(infos[0].tx_hash).toBe(
      "9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92",
    );
    expect(infos[0].outputs.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps block identity for reorg reconciliation", () => {
    expect(infos[0].block_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(infos[0].block_height).toBeGreaterThan(4900000);
  });

  it("retains inline datums where present", () => {
    const withDatum = infos[0].outputs.filter((o) => o.inline_datum !== null);
    expect(withDatum.length).toBeGreaterThanOrEqual(2);
  });
});
