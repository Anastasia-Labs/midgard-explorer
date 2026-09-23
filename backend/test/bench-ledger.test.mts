import { describe, expect, it } from "vitest";
import { decodeMidgardNativeByteListPreimage, decodeMidgardNativeTxFullFromCanonicalCbor }
  from "@al-ft/midgard-core";
import { createLedger } from "../bench/ledger.mjs";
import { loadCorpus } from "../bench/shapeTx.mjs";

/**
 * The UTxO graph is what makes generated transactions loadable and coherent.
 *
 * `outref` is the primary key of both `mempool_ledger` and `confirmed_ledger`,
 * so a duplicate is not a realism complaint, it is a failed load. Value and
 * asset conservation are what stop the address and asset pages from showing
 * balances that could not exist.
 */

const parts = loadCorpus();

const ledgerFor = (seed = 1) =>
  createLedger(parts, {
    seed,
    addresses: 200,
    assets: 40,
    genesisUtxos: 300,
    genesisLovelace: 5_000_000_000n,
    assetsPerOutput: { p50: 0, p95: 2, p99: 5, max: 20 },
    assetQuantity: { p50: 1, p95: 1_000, p99: 100_000, max: 10_000_000 },
    assetHolderSkew: 1.2,
    datumRate: 0.15,
    scriptRefRate: 0.05,
    redeemerRate: 0.2,
  });

describe("createLedger", () => {
  it("seeds a genesis pool of distinct outrefs", () => {
    const ledger = ledgerFor();
    expect(ledger.unspentCount()).toBe(300);
    expect(ledger.seenOutrefs().size).toBe(300);
  });

  it("never produces the same outref twice across the whole run", () => {
    const ledger = ledgerFor();
    let produced = 300;
    for (let i = 0; i < 200; i += 1) {
      const step = ledger.spend({ inputs: 2, outputs: 3 });
      if (step) produced += step.created.length;
    }
    expect(ledger.seenOutrefs().size).toBe(produced);
  });

  it("never spends the same outref twice", () => {
    const ledger = ledgerFor();
    const spent = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const step = ledger.spend({ inputs: 3, outputs: 2 });
      if (!step) continue;
      for (const utxo of step.spent) {
        const key = utxo.outref.toString("hex");
        expect(spent.has(key), `double spend of ${key}`).toBe(false);
        spent.add(key);
      }
    }
    expect(spent.size).toBeGreaterThan(0);
  });

  it("conserves lovelace exactly: inputs equal outputs plus fee", () => {
    const ledger = ledgerFor();
    for (let i = 0; i < 150; i += 1) {
      const step = ledger.spend({ inputs: 2, outputs: 4 });
      if (!step) continue;
      const into = step.spent.reduce((t, u) => t + u.lovelace, 0n);
      const outOf = step.created.reduce((t, u) => t + u.lovelace, 0n);
      expect(into).toBe(outOf + step.fee);
    }
  });

  it("conserves assets exactly, because nothing mints", () => {
    // The base transaction's mint preimage is the empty array, so any asset an
    // output carries must have come from an input. Assets enter the dataset at
    // genesis and only move afterwards.
    const ledger = ledgerFor();
    for (let i = 0; i < 150; i += 1) {
      const step = ledger.spend({ inputs: 3, outputs: 2 });
      if (!step) continue;
      // Quantities, not occurrence counts. An asset held by two inputs must
      // arrive as one summed entry, and a tally of ids would call that equal
      // while the amounts had halved.
      const total = (list: readonly { assets: ReadonlyMap<number, bigint> }[]) => {
        const tally = new Map<number, bigint>();
        for (const u of list) {
          for (const [id, q] of u.assets) tally.set(id, (tally.get(id) ?? 0n) + q);
        }
        return tally;
      };
      const count = total;
      expect(count(step.created)).toEqual(count(step.spent));
    }
  });

  it("spends only outputs that exist, and the transaction says so", () => {
    const ledger = ledgerFor();
    const step = ledger.spend({ inputs: 3, outputs: 2 });
    expect(step).not.toBeNull();
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(step!.tx.bytes));
    const written = decodeMidgardNativeByteListPreimage(full.body.spendInputsPreimageCbor)
      .map((i) => i.toString("hex"));
    expect(written).toEqual(step!.spent.map((u) => u.outref.toString("hex")));
    expect(new Set(written).size).toBe(written.length);
  });

  it("refuses to build a transaction it cannot fund, rather than an invalid one", () => {
    const poor = createLedger(parts, {
      seed: 5,
      addresses: 10,
      assets: 4,
      genesisUtxos: 2,
      genesisLovelace: 2_000_000n,
    });
    // 400 outputs cannot each clear the minimum from two small inputs.
    const step = poor.spend({ inputs: 2, outputs: 400 });
    if (step) {
      expect(step.created.length).toBeLessThan(400);
      for (const u of step.created) expect(u.lovelace).toBeGreaterThan(0n);
    }
  });

  it("I10: the same seed replays the same transactions", () => {
    const a = ledgerFor(9);
    const b = ledgerFor(9);
    for (let i = 0; i < 40; i += 1) {
      const x = a.spend({ inputs: 2, outputs: 2 });
      const y = b.spend({ inputs: 2, outputs: 2 });
      expect(Buffer.from(x!.tx.bytes)).toEqual(Buffer.from(y!.tx.bytes));
    }
  });

  it("concentrates activity on a minority of addresses", () => {
    // A uniform spread gives every address one entry, so `address-history`
    // measures a one-row page and reports a pass. Real explorers are dominated
    // by a few hot addresses.
    const ledger = createLedger(parts, {
      seed: 3,
      addresses: 1_000,
      assets: 50,
      genesisUtxos: 2_000,
      genesisLovelace: 5_000_000_000n,
    });
    for (let i = 0; i < 500; i += 1) {
      ledger.spend({ inputs: 2, outputs: 3 });
    }
    const perAddress = new Map<number, number>();
    for (const id of ledger.addressTouches()) {
      perAddress.set(id, (perAddress.get(id) ?? 0) + 1);
    }
    const counts = [...perAddress.values()].sort((a, b) => b - a);
    const top = counts.slice(0, Math.ceil(counts.length * 0.1));
    const share =
      top.reduce((t, n) => t + n, 0) / counts.reduce((t, n) => t + n, 0);
    expect(share).toBeGreaterThan(0.3);
  });

  it("keeps no ledger bytes inside a shared buffer slab", () => {
    // An entry outlives the batch that produced it. A slice of Node's shared
    // 8 KB slab keeps the whole slab alive, and with it that batch's discarded
    // rows: the streamed `stress` profile grew to 2.7 GB this way.
    const ledger = ledgerFor();
    for (let i = 0; i < 200; i += 1) ledger.spend({ inputs: 2, outputs: 3 });
    const entries = [...ledger.genesis(), ...ledger.remaining()];
    expect(entries.length).toBeGreaterThan(300);
    for (const utxo of entries) {
      for (const bytes of [utxo.outref, utxo.txId, utxo.output]) {
        expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
      }
    }
  });
});
