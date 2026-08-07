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

  /**
   * Asserts the datum CONTENT survived, not merely that the wrapper object is
   * present. Koios returns `{bytes: null, value: null}` unless the request
   * sets `_scripts: true`, and a wrapper-only check passes happily against
   * that empty shell, which is how a null-datum capture would otherwise reach
   * the decoder in the next task unnoticed.
   */
  it("retains decoded inline datum content, not just the wrapper", () => {
    const withValue = infos[0].outputs.filter(
      (o) => o.inline_datum != null && o.inline_datum.value != null,
    );
    expect(withValue.length).toBeGreaterThanOrEqual(2);
  });

  it("exposes a datum shaped like a Plutus constructor", () => {
    const first = infos[0].outputs.find(
      (o) => o.inline_datum != null && o.inline_datum.value != null,
    );
    expect(first).toBeDefined();
    expect(first!.inline_datum!.value).toHaveProperty("fields");
  });
});
