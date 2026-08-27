import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import { ingestTxInfos } from "../src/indexer/ingest.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/** These cases pass no validators, so no event row is written and the identity
 * is never queried back. It is still stated explicitly: the parameter exists so
 * that no call site can leave attribution to a column default. */
const DEPLOYMENT = "f".repeat(64);

/** A transaction whose every section is populated, shaped exactly like a real
 * Koios response. Each section has a distinct, checkable count so a test that
 * loses one section names which one. */
const tx = {
  tx_hash: "a".repeat(64),
  block_height: 100, block_hash: "b".repeat(64),
  absolute_slot: 5000, epoch_no: 7, tx_timestamp: 1_760_000_000,
  fee: "560587", tx_size: 2003, total_output: "2698705507",
  tx_block_index: 9, deposit: "0",
  invalid_before: null, invalid_after: null, metadata: null,
  inputs: [
    { payment_addr: { bech32: "addr_test1_in", cred: "c1" }, stake_addr: null,
      tx_hash: "c".repeat(64), tx_index: 0, value: "1000000",
      datum_hash: null, inline_datum: null, reference_script: null, asset_list: [] },
  ],
  outputs: [
    { payment_addr: { bech32: "addr_test1_out", cred: "c2" }, stake_addr: null,
      tx_hash: "a".repeat(64), tx_index: 0, value: "2000000",
      datum_hash: null, inline_datum: null, reference_script: null,
      asset_list: [{ policy_id: "p".repeat(56), asset_name: "4d41",
        fingerprint: "asset1x", quantity: "1", decimals: 0 }] },
  ],
  reference_inputs: [
    { payment_addr: { bech32: "addr_test1_ref", cred: "c3" }, stake_addr: null,
      tx_hash: "d".repeat(64), tx_index: 1, value: "3000000",
      datum_hash: null, inline_datum: null,
      reference_script: { hash: "e".repeat(56), size: 100, type: "plutusV3" },
      asset_list: [] },
  ],
  collateral_inputs: [
    { payment_addr: { bech32: "addr_test1_col", cred: "c4" }, stake_addr: null,
      tx_hash: "f".repeat(64), tx_index: 2, value: "5000000",
      datum_hash: null, inline_datum: null, reference_script: null, asset_list: [] },
  ],
  collateral_output: null,
  assets_minted: [{ policy_id: "q".repeat(56), asset_name: "4d42",
    fingerprint: "asset1y", quantity: "1", decimals: 0 }],
  plutus_contracts: [
    { address: "addr_test1_out", script_hash: "s".repeat(56), size: 500,
      valid_contract: true, spends_input: true,
      input: { redeemer: { purpose: "spend", fee: "2066",
        unit: { mem: "26028", steps: "7811793" },
        datum: { hash: "h".repeat(64), value: { constructor: 0, fields: [] } } } } },
  ],
} as never;

describe("ingestTxInfos full detail", () => {
  beforeEach(async () => { await truncateL1(); });
  afterAll(async () => { await indexerPrisma.$disconnect(); });

  it("stores the scalar fields Koios reports about the transaction", async () => {
    await ingestTxInfos([tx], [], DEPLOYMENT);
    const row = await indexerPrisma.l1Tx.findUniqueOrThrow({ where: { txHash: "a".repeat(64) } });
    expect(row.fee).toBe(560587n);
    expect(row.size).toBe(2003);
    expect(row.totalOutput).toBe(2698705507n);
    expect(row.blockIndex).toBe(9);
  });

  // One assertion per kind. A single "4 ios" assertion would still pass if
  // inputs were written twice and collateral not at all.
  it.each([
    ["input", 1, "addr_test1_in"],
    ["output", 1, "addr_test1_out"],
    ["reference", 1, "addr_test1_ref"],
    ["collateral", 1, "addr_test1_col"],
  ])("stores %s UTxOs", async (kind, count, address) => {
    await ingestTxInfos([tx], [], DEPLOYMENT);
    const rows = await indexerPrisma.l1TxIo.findMany({ where: { kind } });
    expect(rows).toHaveLength(count);
    expect(rows[0]!.address).toBe(address);
  });

  it("attaches an output's native assets to that output", async () => {
    await ingestTxInfos([tx], [], DEPLOYMENT);
    const out = await indexerPrisma.l1TxIo.findFirstOrThrow({ where: { kind: "output" } });
    const assets = await indexerPrisma.l1TxAsset.findMany({ where: { ioId: out.id } });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.quantity).toBe(1n);
  });

  it("stores minted assets against the transaction, not against a UTxO", async () => {
    await ingestTxInfos([tx], [], DEPLOYMENT);
    const mints = await indexerPrisma.l1TxAsset.findMany({ where: { kind: "mint" } });
    expect(mints).toHaveLength(1);
    expect(mints[0]!.ioId).toBeNull();
    expect(mints[0]!.policyId).toBe("q".repeat(56));
  });

  it("stores the redeemer, which is what names the operation invoked", async () => {
    await ingestTxInfos([tx], [], DEPLOYMENT);
    const [r] = await indexerPrisma.l1Redeemer.findMany();
    expect(r!.purpose).toBe("spend");
    expect(r!.memUnits).toBe(26028n);
    expect(r!.stepUnits).toBe(7811793n);
    expect(r!.validContract).toBe(true);
  });

  // Koios reports this one as a single nullable object rather than an array,
  // which is exactly how it went unread while every array section was handled.
  it("stores the collateral output, which is one UTxO and not a list", async () => {
    await ingestTxInfos(
      [
        {
          ...(tx as Record<string, unknown>),
          collateral_output: {
            payment_addr: { bech32: "addr_test1_colret", cred: "c9" },
            stake_addr: null, tx_hash: "a".repeat(64), tx_index: 3,
            value: "2684266094", datum_hash: null, inline_datum: null,
            reference_script: null, asset_list: [],
          },
        },
      ] as never,
      [],
      DEPLOYMENT,
    );
    const rows = await indexerPrisma.l1TxIo.findMany({ where: { kind: "collateral_output" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.position).toBe(0);
    expect(rows[0]!.lovelace).toBe(2684266094n);
    expect(rows[0]!.address).toBe("addr_test1_colret");
  });

  it("is idempotent, so a reorg rescan does not duplicate rows", async () => {
    await ingestTxInfos([tx], [], DEPLOYMENT);
    await ingestTxInfos([tx], [], DEPLOYMENT);
    expect(await indexerPrisma.l1TxIo.count()).toBe(4);
    expect(await indexerPrisma.l1TxAsset.count()).toBe(2);
    expect(await indexerPrisma.l1Redeemer.count()).toBe(1);
  });
});
