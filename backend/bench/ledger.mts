import type { Shape } from "./profiles.mjs";
import { rng, sampleCount } from "./random.mjs";
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
  /**
   * Asset id to quantity. A Map, not a list: an output funded by two inputs
   * that both held asset 7 carries one entry with the summed quantity, and
   * conservation is checked against those sums rather than against occurrence
   * counts.
   */
  assets: ReadonlyMap<number, bigint>;
  hasDatum: boolean;
  hasScriptRef: boolean;
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
  /** Distinct assets placed on one output. Realized at genesis and preserved. */
  assetsPerOutput?: Shape;
  /** Quantity per asset position. */
  assetQuantity?: Shape;
  /**
   * Zipf exponent for which asset an id draw lands on. Concentrates holdings on
   * a minority of assets, which is what the asset roster actually meets.
   */
  assetHolderSkew?: number;
  /** Share of outputs carrying an inline datum. */
  datumRate?: number;
  /** Share of outputs carrying a script reference. */
  scriptRefRate?: number;
  /** Share of transactions carrying redeemers. */
  redeemerRate?: number;
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
};

export type SpendResult = {
  tx: ShapedTx;
  spent: readonly Utxo[];
  created: readonly Utxo[];
  fee: bigint;
  withRedeemers: boolean;
};

export type Ledger = {
  spend: (spec: SpendSpec) => SpendResult | null;
  unspentCount: () => number;
  seenOutrefs: () => ReadonlySet<string>;
  addressTouches: () => readonly number[];
  genesis: () => readonly Utxo[];
  /** The unspent set: what the live ledger tables hold at the end of a run. */
  remaining: () => readonly Utxo[];
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
  const pickAsset = zipf(options.assets, options.assetHolderSkew ?? 1.1);
  const assetsPerOutput = options.assetsPerOutput ?? { p50: 0, p95: 2, p99: 5, max: 20 };
  const assetQuantity = options.assetQuantity ?? { p50: 1, p95: 1_000, p99: 100_000, max: 10_000_000 };
  const datumRate = options.datumRate ?? 0;
  const scriptRefRate = options.scriptRefRate ?? 0;
  const redeemerRate = options.redeemerRate ?? 0;
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
    assets: ReadonlyMap<number, bigint>,
    hasDatum: boolean,
    hasScriptRef: boolean,
  ): Utxo => {
    const shaped = makeOutput(parts, {
      addressId,
      lovelace,
      assets,
      datum: hasDatum,
      scriptRef: hasScriptRef,
    });
    return {
      outref: outrefOf(txId, index),
      txId,
      index,
      addressId,
      address: shaped.address,
      lovelace,
      assets,
      hasDatum,
      hasScriptRef,
      output: Buffer.from(shaped.output),
    };
  };

  /** Assets for one genesis output: a skewed draw of ids, each with a quantity. */
  const drawAssets = (): Map<number, bigint> => {
    const holdings = new Map<number, bigint>();
    if (options.assets <= 0) return holdings;
    const wanted = sampleCount(next(), assetsPerOutput);
    for (let i = 0; i < wanted; i += 1) {
      const id = pickAsset(next());
      const quantity = BigInt(Math.max(1, sampleCount(next(), assetQuantity)));
      holdings.set(id, (holdings.get(id) ?? 0n) + quantity);
    }
    return holdings;
  };

  // Genesis. One synthetic transaction id per output keeps the outrefs distinct
  // without pretending a single genesis transaction produced thousands.
  const genesisUtxos: Utxo[] = [];
  for (let i = 0; i < options.genesisUtxos; i += 1) {
    const txId = Buffer.alloc(32);
    txId.writeUInt32BE(i + 1, 28);
    genesisUtxos.push(
      record(
        utxoFrom(
          txId,
          0,
          pickAddress(next()),
          options.genesisLovelace,
          drawAssets(),
          next() < datumRate,
          next() < scriptRefRate,
        ),
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

    // Consolidate rather than give up.
    //
    // Repeated splitting fragments the ledger: after a few thousand blocks of
    // one-in-three-out the average UTxO is too small to fund an output on its
    // own, and a fixed input count starts returning null. A caller that treats
    // null as "stop" then silently produces an empty table, which is how
    // `processed_mempool` came out empty at `target` while passing at `small`.
    // Taking another input is also what a real wallet does.
    let available = spent.reduce((total, u) => total + u.lovelace, 0n);
    const floor = fee + MIN_OUTPUT_LOVELACE;
    while (available <= floor && unspent.length > 0 && spent.length < 64) {
      const extra = takeInputs(1);
      if (extra.length === 0) break;
      spent.push(...extra);
      available += extra[0].lovelace;
    }
    if (available <= floor) {
      // Genuinely unfundable. Put the inputs back rather than burn them.
      unspent.push(...spent);
      return null;
    }
    const spendable = available - fee;
    const affordable = Number(spendable / MIN_OUTPUT_LOVELACE);
    const count = Math.max(1, Math.min(spec.outputs, affordable));

    // Assets move; they are never created. Every unit an input held lands on
    // exactly one output. Positions are spread round robin, and a repeated
    // asset id sums rather than appearing twice, because a Map key is unique
    // and the ledger tables would collapse it anyway.
    const incoming: [number, bigint][] = [];
    for (const utxo of spent) {
      for (const [id, quantity] of utxo.assets) incoming.push([id, quantity]);
    }
    const perOutput: Map<number, bigint>[] = Array.from(
      { length: count },
      () => new Map<number, bigint>(),
    );
    incoming.forEach(([id, quantity], i) => {
      const slot = perOutput[i % count];
      slot.set(id, (slot.get(id) ?? 0n) + quantity);
    });

    const each = spendable / BigInt(count);
    const remainder = spendable - each * BigInt(count);

    const addressIds = Array.from({ length: count }, () => pickAddress(next()));
    const datums = Array.from({ length: count }, () => next() < datumRate);
    const scriptRefs = Array.from({ length: count }, () => next() < scriptRefRate);
    const withRedeemers = next() < redeemerRate;
    const outputs = addressIds.map((addressId, i) =>
      makeOutput(parts, {
        addressId,
        lovelace: i === 0 ? each + remainder : each,
        assets: perOutput[i],
        datum: datums[i],
        scriptRef: scriptRefs[i],
      }),
    );
    const tx = buildTx(
      parts,
      spent.map((u) => u.outref),
      outputs,
      fee,
      withRedeemers,
    );

    const created = outputs.map((shaped, i) =>
      record({
        outref: outrefOf(tx.txId, i),
        txId: Buffer.from(tx.txId),
        index: i,
        addressId: addressIds[i],
        address: shaped.address,
        lovelace: i === 0 ? each + remainder : each,
        assets: perOutput[i],
        hasDatum: datums[i],
        hasScriptRef: scriptRefs[i],
        output: Buffer.from(shaped.output),
      }),
    );
    return { tx, spent, created, fee, withRedeemers };
  };

  return {
    spend,
    unspentCount: () => unspent.length,
    seenOutrefs: () => seen,
    addressTouches: () => touches,
    genesis: () => genesisUtxos,
    remaining: () => unspent,
  };
}
