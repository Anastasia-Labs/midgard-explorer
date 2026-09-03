import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  L1BlockHeader,
  L1TransactionResponse,
  TransactionWithMeta,
} from "@midgard-explorer/contracts";
import { L1_TXS, TXS } from "../e2e/fixtures/data.mjs";

/**
 * The fixture backend must satisfy the same contract the real backend does.
 *
 * Without this, a fixture that drifts from the schema only fails in the e2e
 * suite, and it fails as "no rows on the page" twelve minutes later rather than
 * as "this field is wrong" in a second. That is exactly how a signed mint
 * quantity got through: `DecimalString` is `/^\d+$/`, a burn is negative, and
 * Schema rejected the whole response rather than the one field.
 */

const decode = Schema.decodeUnknownEither(TransactionWithMeta);
const decodeL1 = Schema.decodeUnknownEither(L1TransactionResponse);

describe("fixture transactions satisfy the wire contract", () => {
  const decodable = TXS.filter((t) => t.transaction !== null && !t.decodeError).map((t) => ({
    ...t,
    transaction: t.transaction!,
  }));

  it("has transactions to check, so this gate is not measuring nothing", () => {
    expect(decodable.length).toBeGreaterThan(0);
  });

  it("decodes every fixture transaction", () => {
    const failures: string[] = [];
    for (const t of decodable) {
      const result = decode({ ...t.transaction, timestamp: t.time_stamp_tz });
      if (result._tag === "Left") {
        failures.push(`${t.tx_id.slice(0, 12)}…: ${String(result.left).slice(0, 200)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("covers a burn, so a negative quantity cannot regress unnoticed", () => {
    const burns = decodable.flatMap((t) =>
      (t.transaction.mint?.assets ?? []).filter((a) => a.quantity.startsWith("-")),
    );
    expect(burns.length).toBeGreaterThan(0);
  });

  it("covers a datum that will not decode to JSON", () => {
    const hexOnly = decodable.flatMap((t) =>
      t.transaction.outputs.filter((o) => o.datum !== null && o.datum.json === null),
    );
    expect(hexOnly.length).toBeGreaterThan(0);
  });

  it("covers both address kinds", () => {
    const kinds = new Set(
      decodable.flatMap((t) => t.transaction.outputs.map((o) => o.addressKind)),
    );
    expect([...kinds].sort()).toEqual(["PubKey", "Script"]);
  });
});

describe("fixture L1 transactions satisfy the wire contract", () => {
  it("decodes every full Cardano transaction", () => {
    const failures: string[] = [];
    for (const tx of L1_TXS) {
      const result = decodeL1(tx);
      if (result._tag === "Left") {
        failures.push(`${tx.txHash.slice(0, 12)}...: ${String(result.left).slice(0, 240)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("covers every investigation section", () => {
    const tx = L1_TXS[0]!;
    expect(tx.referenceInputs.length).toBeGreaterThan(0);
    expect(tx.collateral.length).toBeGreaterThan(0);
    expect(tx.collateralOutput).not.toBeNull();
    expect(tx.mints.some((asset) => asset.quantity.startsWith("-"))).toBe(true);
    expect(tx.redeemers.length).toBeGreaterThan(0);
    expect(tx.events.length).toBeGreaterThan(0);
    expect(tx.metadata).not.toBeNull();
  });
});

/**
 * The fixture must key block headers the way the backend now does.
 *
 * This is the parity that was missing when it mattered most. The fixture served
 * the L2 header hash under `headerHash` while the indexer stored a 32-byte
 * `utxosRoot` there, so the join worked in every test and in no deployment, and
 * three pages shipped dead links behind a green suite. `Hash28` makes the
 * fixture unable to drift back.
 */
describe("fixture L1 block headers satisfy the wire contract", () => {
  const decodeHeader = Schema.decodeUnknownEither(L1BlockHeader);

  it("has headers to check, so this gate is not measuring nothing", async () => {
    const { l1BlockHeaders } = await import("../e2e/fixtures/data.mjs").then((m) => ({
      l1BlockHeaders: m.BLOCKS,
    }));
    expect(l1BlockHeaders.length).toBeGreaterThan(0);
  });

  it("keys every fixture header by a 28-byte hash, never a Merkle root", async () => {
    const { BLOCKS } = await import("../e2e/fixtures/data.mjs");
    const wrong = BLOCKS.map((b: { header_hash: string }) => b.header_hash).filter(
      (hash: string) => !/^[0-9a-f]{56}$/.test(hash),
    );
    expect(wrong).toEqual([]);
  });

  it("rejects a header keyed by a 32-byte root", () => {
    const rooted = {
      headerHash: "f671fe1d677219f81f40d99329a349654f71671302dddd48f3b5e8d141ea10a8",
      l1TxHash: null,
      blockHeight: null,
      prevUtxosRoot: "00",
      utxosRoot: "00",
      withdrawalsRoot: "00",
      forcedTransactionsRoot: "00",
      transactionsRoot: "00",
      depositsRoot: "00",
      transitionTraceRoot: "00",
      eventToStepRoot: "00",
      withdrawalCount: "0",
      forcedTransactionCount: "0",
      l2TransactionCount: "0",
      depositCount: "0",
      totalEventCount: "0",
      transitionStepCount: "0",
      startTime: "0",
      endTime: "0",
      prevHeaderHash: "00",
      operatorVkey: "00",
      protocolVersion: "1",
    };
    expect(decodeHeader(rooted)._tag).toBe("Left");
  });
});
