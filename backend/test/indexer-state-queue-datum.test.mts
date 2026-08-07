import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseTxInfo } from "../src/indexer/koios.js";
import { decodeStateQueueDatum } from "../src/indexer/stateQueueDatum.js";

/**
 * Decoded against a real preprod state queue output. The block contains one
 * deposit and zero withdrawals/forced transactions. This means deposits_root
 * is not empty, but withdrawals/forced/transactions roots are. The counter
 * cross-checks below ensure roots match their corresponding counts, which is
 * how we catch field-ordering bugs rather than just pattern-matching for roots.
 */

const STATE_QUEUE_ADDR =
  "addr_test1wpt39wx3rdvwrl80futqv7emqljqquaxggfqzgyeqpdjrkqhge828";
const EMPTY_ROOT =
  "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8";

const infos = parseTxInfo(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/koios/tx-info-state-queue.json", import.meta.url),
      "utf8",
    ),
  ),
);

const datumOutput = infos[0].outputs.find(
  (o) => o.payment_addr.bech32 === STATE_QUEUE_ADDR && o.inline_datum !== null,
);

describe("decodeStateQueueDatum", () => {
  it("finds a state queue output to decode", () => {
    expect(datumOutput).toBeDefined();
  });

  it("extracts all 19 fields", () => {
    const h = decodeStateQueueDatum(datumOutput!.inline_datum!.value);
    expect(h).not.toBeNull();
    expect(h).toHaveProperty("prevUtxosRoot");
    expect(h).toHaveProperty("utxosRoot");
    expect(h).toHaveProperty("withdrawalsRoot");
    expect(h).toHaveProperty("forcedTransactionsRoot");
    expect(h).toHaveProperty("transactionsRoot");
    expect(h).toHaveProperty("depositsRoot");
    expect(h).toHaveProperty("transitionTraceRoot");
    expect(h).toHaveProperty("eventToStepRoot");
    expect(h).toHaveProperty("withdrawalCount");
    expect(h).toHaveProperty("forcedTransactionCount");
    expect(h).toHaveProperty("l2TransactionCount");
    expect(h).toHaveProperty("depositCount");
    expect(h).toHaveProperty("totalEventCount");
    expect(h).toHaveProperty("transitionStepCount");
    expect(h).toHaveProperty("startTime");
    expect(h).toHaveProperty("endTime");
    expect(h).toHaveProperty("prevHeaderHash");
    expect(h).toHaveProperty("operatorVkey");
    expect(h).toHaveProperty("protocolVersion");
  });

  it("extracts eight 32-byte Merkle roots", () => {
    const h = decodeStateQueueDatum(datumOutput!.inline_datum!.value)!;
    for (const root of [
      h.prevUtxosRoot,
      h.utxosRoot,
      h.withdrawalsRoot,
      h.forcedTransactionsRoot,
      h.transactionsRoot,
      h.depositsRoot,
      h.transitionTraceRoot,
      h.eventToStepRoot,
    ]) {
      expect(root).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("cross-checks empty roots against event counts", () => {
    const h = decodeStateQueueDatum(datumOutput!.inline_datum!.value)!;
    if (h.withdrawalCount === 0n) {
      expect(h.withdrawalsRoot).toBe(EMPTY_ROOT);
    }
    if (h.forcedTransactionCount === 0n) {
      expect(h.forcedTransactionsRoot).toBe(EMPTY_ROOT);
    }
    if (h.l2TransactionCount === 0n) {
      expect(h.transactionsRoot).toBe(EMPTY_ROOT);
    }
  });

  it("cross-checks non-empty roots against event counts", () => {
    const h = decodeStateQueueDatum(datumOutput!.inline_datum!.value)!;
    if (h.depositCount > 0n) {
      expect(h.depositsRoot).not.toBe(EMPTY_ROOT);
    }
    if (h.withdrawalCount > 0n) {
      expect(h.withdrawalsRoot).not.toBe(EMPTY_ROOT);
    }
    if (h.forcedTransactionCount > 0n) {
      expect(h.forcedTransactionsRoot).not.toBe(EMPTY_ROOT);
    }
  });

  it("reads timestamps as millisecond bigints in order", () => {
    const h = decodeStateQueueDatum(datumOutput!.inline_datum!.value)!;
    expect(h.endTime).toBeGreaterThan(h.startTime);
    expect(h.startTime).toBeGreaterThan(1_700_000_000_000n);
  });

  it("reads 28-byte key hashes", () => {
    const h = decodeStateQueueDatum(datumOutput!.inline_datum!.value)!;
    expect(h.prevHeaderHash).toMatch(/^[0-9a-f]{56}$/);
    expect(h.operatorVkey).toMatch(/^[0-9a-f]{56}$/);
  });

  it("reads event counts as non-negative bigints", () => {
    const h = decodeStateQueueDatum(datumOutput!.inline_datum!.value)!;
    expect(h.withdrawalCount).toBeGreaterThanOrEqual(0n);
    expect(h.forcedTransactionCount).toBeGreaterThanOrEqual(0n);
    expect(h.l2TransactionCount).toBeGreaterThanOrEqual(0n);
    expect(h.depositCount).toBeGreaterThanOrEqual(0n);
    expect(h.totalEventCount).toBeGreaterThanOrEqual(0n);
    expect(h.transitionStepCount).toBeGreaterThanOrEqual(0n);
  });

  /**
   * Guard isolation. A malformed datum that is wrong in many slots at once
   * proves nothing: it gets rejected by whichever check runs first, so the
   * check you meant to test can be deleted and the test still passes. Each
   * case below starts from a fully valid synthetic header and breaks exactly
   * one thing, so only the guard under test can reject it.
   */
  const root = (c: string) => ({ bytes: c.repeat(64) });
  const hash28 = (c: string) => ({ bytes: c.repeat(56) });
  const validLeaves = (): Array<{ bytes: string } | { int: number }> => [
    root("1"), root("2"), root("3"), root("4"),
    root("5"), root("6"), root("7"), root("8"),
    { int: 0 }, { int: 0 }, { int: 0 }, { int: 1 }, { int: 1 }, { int: 1 },
    { int: 1785050632000 }, { int: 1785058843000 },
    hash28("a"), hash28("b"),
    { int: 0 },
  ];

  it("decodes the synthetic valid header, proving the builder is sound", () => {
    expect(decodeStateQueueDatum({ fields: validLeaves() })).not.toBeNull();
  });

  it("returns null when the leaf count exceeds the header's", () => {
    const tooMany = { fields: [...validLeaves(), { int: 7 }] };
    expect(decodeStateQueueDatum(tooMany)).toBeNull();
  });

  it("returns null when a root slot holds a non-root value", () => {
    const leaves = validLeaves();
    leaves[0] = { bytes: "aa" };
    expect(decodeStateQueueDatum({ fields: leaves })).toBeNull();
  });

  it("returns null when a 28-byte slot holds a 32-byte value", () => {
    const leaves = validLeaves();
    leaves[17] = root("c");
    expect(decodeStateQueueDatum({ fields: leaves })).toBeNull();
  });

  it("returns null rather than throwing on an unrecognised shape", () => {
    expect(decodeStateQueueDatum({ int: 1 })).toBeNull();
    expect(decodeStateQueueDatum(null)).toBeNull();
    expect(decodeStateQueueDatum({ fields: [] })).toBeNull();
  });
});
