import { rng } from "./random.mjs";
import {
  buildTx,
  makeOutput,
  outrefOf,
  type CorpusParts,
  type ShapedTx,
} from "./shapeTx.mjs";

/**
 * A UTxO graph for the shaped seed.
 *
 * Codec-readable is a weaker property than spendable. An earlier version cycled
 * two input templates, which put duplicate inputs inside one transaction and
 * re-spent the same outref in every transaction of the dataset. `outref` is the
 * primary key of `mempool_ledger` and `confirmed_ledger`, so that dataset does
 * not merely misrepresent a chain, it fails to load.
 *
 * What this maintains:
 *
 *   - every outref is produced once and spent at most once;
 *   - every input names an output that was produced earlier;
 *   - lovelace balances exactly: inputs equal outputs plus fee;
 *   - assets are conserved, because nothing mints. The corpus transaction's
 *     mint preimage is the empty array, so assets enter at genesis and only
 *     move afterwards. An output carrying an asset no input held would be
 *     inventing supply, and the asset pages would report it.
 *
 * What this does NOT maintain, stated rather than implied: the witness set is
 * the corpus one, so signatures do not correspond to the bodies built here and
 * addresses are not the hashes of any key that signed. Making them correspond
 * needs blake2b224 for the payment credential, which Node's crypto does not
 * offer, plus key generation and address derivation. Nothing the explorer does
 * reads a witness or checks a credential, so this buys no measurement. It is a
 * real limit on the word "valid" and every consumer of this data should know
 * it.
 */

/** Enough to clear a minimum-ada output comfortably at any asset count. */
const MIN_OUTPUT_LOVELACE = 1_500_000n;

/** Flat, and close to the corpus transaction's own fee. */
const FEE = 200_000n;

export type Utxo = {
  outref: Buffer;
  txId: Buffer;
  index: number;
  addressId: number;
  address: string;
  lovelace: bigint;
  assetIds: readonly number[];
  output: Buffer;
};

export type LedgerOptions = {
  seed: number;
  /** Distinct addresses the graph draws from. */
  addresses: number;
  /** Distinct asset ids placed into circulation at genesis. */
  assets: number;
  genesisUtxos: number;
  genesisLovelace: bigint;
  /**
   * Zipf exponent for address selection. Above zero concentrates activity on a
   * minority of addresses, which is what `address-history` actually meets.
   */
  addressSkew?: number;
  fee?: bigint;
};

export type SpendSpec = {
  inputs: number;
  outputs: number;
  assetsPerOutput: number;
};

export type SpendResult = {
  tx: ShapedTx;
  spent: readonly Utxo[];
  created: readonly Utxo[];
  fee: bigint;
};

export type Ledger = {
  spend: (spec: SpendSpec) => SpendResult | null;
  unspentCount: () => number;
  seenOutrefs: () => ReadonlySet<string>;
  addressTouches: () => readonly number[];
  genesis: () => readonly Utxo[];
};

/** A Zipf sampler over `n` ranks, built once and inverted per draw. */
function zipf(n: number, exponent: number): (u: number) => number {
  const cumulative = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    total += 1 / Math.pow(i + 1, exponent);
    cumulative[i] = total;
  }
  return (u: number) => {
    const target = u * total;
    let low = 0;
    let high = n - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid] < target) low = mid + 1;
      else high = mid;
    }
    return low;
  };
}

export function createLedger(parts: CorpusParts, options: LedgerOptions): Ledger {
  const next = rng(options.seed);
  const fee = options.fee ?? FEE;
  const pickAddress = zipf(options.addresses, options.addressSkew ?? 1.1);
  const unspent: Utxo[] = [];
  const seen = new Set<string>();
  const touches: number[] = [];

  const record = (utxo: Utxo): Utxo => {
    const key = utxo.outref.toString("hex");
    if (seen.has(key)) throw new Error(`outref produced twice: ${key}`);
    seen.add(key);
    unspent.push(utxo);
    touches.push(utxo.addressId);
    return utxo;
  };

  const utxoFrom = (
    txId: Buffer,
    index: number,
    addressId: number,
    lovelace: bigint,
    assetIds: readonly number[],
  ): Utxo => {
    const shaped = makeOutput(parts, { addressId, lovelace, assetIds });
    return {
      outref: outrefOf(txId, index),
      txId,
      index,
      addressId,
      address: shaped.address,
      lovelace,
      assetIds,
      output: Buffer.from(shaped.output),
    };
  };

  // Genesis. One synthetic transaction id per output keeps the outrefs distinct
  // without pretending a single genesis transaction produced thousands.
  const genesisUtxos: Utxo[] = [];
  for (let i = 0; i < options.genesisUtxos; i += 1) {
    const txId = Buffer.alloc(32);
    txId.writeUInt32BE(i + 1, 28);
    const assetIds =
      options.assets > 0 && i % 3 === 0 ? [i % options.assets] : [];
    genesisUtxos.push(
      record(
        utxoFrom(txId, 0, pickAddress(next()), options.genesisLovelace, assetIds),
      ),
    );
  }

  const takeInputs = (count: number): Utxo[] => {
    const taken: Utxo[] = [];
    for (let i = 0; i < count && unspent.length > 0; i += 1) {
      const at = Math.floor(next() * unspent.length);
      taken.push(unspent.splice(at, 1)[0]);
    }
    return taken;
  };

  const spend = (spec: SpendSpec): SpendResult | null => {
    const spent = takeInputs(Math.max(1, spec.inputs));
    if (spent.length === 0) return null;

    const available = spent.reduce((total, u) => total + u.lovelace, 0n);
    if (available <= fee + MIN_OUTPUT_LOVELACE) {
      // Cannot fund even one output. Put the inputs back rather than burn them.
      unspent.push(...spent);
      return null;
    }
    const spendable = available - fee;
    const affordable = Number(spendable / MIN_OUTPUT_LOVELACE);
    const count = Math.max(1, Math.min(spec.outputs, affordable));

    // Assets move; they are never created. Every asset held by an input lands
    // on exactly one output, spread round robin.
    const incoming = spent.flatMap((u) => [...u.assetIds]);
    const perOutput: number[][] = Array.from({ length: count }, () => []);
    incoming.forEach((id, i) => perOutput[i % count].push(id));

    const each = spendable / BigInt(count);
    const remainder = spendable - each * BigInt(count);

    const addressIds = Array.from({ length: count }, () => pickAddress(next()));
    const outputs = addressIds.map((addressId, i) =>
      makeOutput(parts, {
        addressId,
        lovelace: i === 0 ? each + remainder : each,
        assetIds: perOutput[i],
      }),
    );
    const tx = buildTx(
      parts,
      spent.map((u) => u.outref),
      outputs,
      fee,
    );

    const created = outputs.map((shaped, i) =>
      record({
        outref: outrefOf(tx.txId, i),
        txId: Buffer.from(tx.txId),
        index: i,
        addressId: addressIds[i],
        address: shaped.address,
        lovelace: i === 0 ? each + remainder : each,
        assetIds: perOutput[i],
        output: Buffer.from(shaped.output),
      }),
    );
    return { tx, spent, created, fee };
  };

  return {
    spend,
    unspentCount: () => unspent.length,
    seenOutrefs: () => seen,
    addressTouches: () => touches,
    genesis: () => genesisUtxos,
  };
}
