import { getCodec } from "./codec";
import type {
  AssetMap,
  InputView,
  OutRef,
  OutputView,
  TransactionView,
  ValueView,
} from "./types";

/**
 * Injected lookup that turns a spend-input outref into its produced output bytes
 * (kept out of this module so the adapter stays free of DB concerns). Returns null
 * when the UTxO can't be resolved.
 */
export type OutRefLookup = (
  outref: Uint8Array,
) => Promise<{ address: string; output: Uint8Array } | null>;

const SUPPORTED_VERSION = 1n;

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/** Flatten the codec's nested ReadonlyMap value into a JSON-serializable object. */
const assetsToRecord = (
  assets: ReadonlyMap<string, ReadonlyMap<string, bigint>>,
): AssetMap => {
  const out: AssetMap = {};
  for (const [policyId, names] of assets) {
    const inner: Record<string, bigint> = {};
    for (const [assetName, quantity] of names) inner[assetName] = quantity;
    out[policyId] = inner;
  }
  return out;
};

const toValueView = (value: {
  lovelace: bigint;
  assets: ReadonlyMap<string, ReadonlyMap<string, bigint>>;
}): ValueView => ({
  lovelace: value.lovelace,
  assets: assetsToRecord(value.assets),
});

/**
 * Decode a Midgard-native canonical-CBOR transaction (the `tx` column of the
 * immutable/mempool tables) into the frontend JSON contract.
 *
 * Throws on an unsupported format version so a future codec change surfaces as a
 * clear error rather than silently mis-decoded data.
 */
export async function decodeTransaction(
  txBytes: Uint8Array,
  lookup?: OutRefLookup,
): Promise<TransactionView> {
  const codec = await getCodec();

  const full = codec.decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(txBytes));
  if (full.version !== SUPPORTED_VERSION) {
    throw new Error(
      `Unsupported Midgard tx format version: ${full.version} (expected ${SUPPORTED_VERSION})`,
    );
  }

  // Each spend/reference input preimage item is a standard CBOR [txid, index] pair.
  const decodeOutRef = (bytes: Uint8Array): OutRef => {
    const [txId, index] = codec.decodeSingleCbor(bytes) as [Uint8Array, number | bigint];
    return { txId: toHex(txId), index: Number(index) };
  };

  const inputs = await Promise.all(
    codec
      .decodeMidgardNativeByteListPreimage(full.body.spendInputsPreimageCbor)
      .map(async (item): Promise<InputView> => {
        const ref = decodeOutRef(item);
        if (!lookup) return { ...ref, resolved: null };
        // The raw preimage item is the canonical outref key used by the ledger.
        const hit = await lookup(item);
        if (!hit) return { ...ref, resolved: null };
        const output = codec.decodeMidgardTxOutput(Buffer.from(hit.output));
        return {
          ...ref,
          resolved: { address: hit.address, value: toValueView(output.value) },
        };
      }),
  );

  const referenceInputs = codec
    .decodeMidgardNativeByteListPreimage(full.body.referenceInputsPreimageCbor)
    .map(decodeOutRef);

  const outputs: OutputView[] = codec
    .decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor)
    .map((item) => {
      const output = codec.decodeMidgardTxOutput(item);
      return {
        address: codec.encodeMidgardAddressText(output.address),
        value: toValueView(output.value),
        hasDatum: output.datum !== undefined,
        hasScriptRef: output.script_ref !== undefined,
      };
    });

  const decodedMint = codec.decodeMidgardNativeMint(full.body.mintPreimageCbor);
  const mint = decodedMint ? { policyIds: [...decodedMint.policyIds] } : null;

  // Witness preimages are CBOR lists; we report counts without decoding each item.
  const countItems = (preimage: Uint8Array): number =>
    (codec.decodeSingleCbor(preimage) as unknown[]).length;

  const noneTime = codec.MIDGARD_POSIX_TIME_NONE;
  const noneNetwork = codec.MIDGARD_NATIVE_NETWORK_ID_NONE;
  const { body } = full;

  return {
    txId: toHex(codec.computeMidgardNativeTxId(full)),
    formatVersion: Number(full.version),
    validity: full.validity,
    fee: body.fee,
    validityInterval: {
      start: body.validityIntervalStart === noneTime ? null : body.validityIntervalStart,
      end: body.validityIntervalEnd === noneTime ? null : body.validityIntervalEnd,
    },
    networkId: body.networkId === noneNetwork ? null : Number(body.networkId),
    inputs,
    referenceInputs,
    outputs,
    mint,
    witnesses: {
      vkeyCount: countItems(full.witnessSet.addrTxWitsPreimageCbor),
      scriptCount: countItems(full.witnessSet.scriptTxWitsPreimageCbor),
      redeemerCount: countItems(full.witnessSet.redeemerTxWitsPreimageCbor),
    },
  };
}

/**
 * Sum a set of ledger outputs (Midgard-native canonical CBOR) into a single value.
 * Used for an address balance computed from the ledger rather than replayed from a
 * partial tx history on the client.
 *
 * Outputs the codec cannot decode (e.g. genesis rows written in CML array form
 * rather than Midgard-native map form) are skipped and counted in
 * `undecodedOutputs`, so one bad row degrades the balance instead of failing it.
 */
export async function computeBalance(
  outputs: Uint8Array[],
): Promise<{ balance: ValueView; undecodedOutputs: number }> {
  const codec = await getCodec();
  let lovelace = 0n;
  let undecodedOutputs = 0;
  const assets = new Map<string, Map<string, bigint>>();
  for (const bytes of outputs) {
    let value;
    try {
      ({ value } = codec.decodeMidgardTxOutput(Buffer.from(bytes)));
    } catch {
      undecodedOutputs += 1;
      continue;
    }
    lovelace += value.lovelace;
    for (const [policyId, names] of value.assets) {
      const inner = assets.get(policyId) ?? new Map<string, bigint>();
      for (const [assetName, quantity] of names) {
        inner.set(assetName, (inner.get(assetName) ?? 0n) + quantity);
      }
      assets.set(policyId, inner);
    }
  }
  return { balance: toValueView({ lovelace, assets }), undecodedOutputs };
}

export type UtxoView = {
  txId: string | null;
  index: number | null;
  /** The canonical ledger key, kept whether or not it parsed into a pair. */
  outRefHex: string;
  value: ValueView | null;
  hasDatum: boolean;
  hasScriptRef: boolean;
  decodeError: string | null;
};

/**
 * The individual UTxOs behind a balance.
 *
 * A UTxO whose output will not decode is still a UTxO, so it is returned with
 * a null value and its error rather than dropped: an address holding six UTxOs
 * of which one is unreadable should show six rows and one warning, not five
 * rows and a silently smaller total. The outref is kept even when it fails to
 * parse into a transaction and index, because it is the ledger's own key and
 * remains the only handle on that entry.
 */
export async function decodeUtxos(
  rows: Array<{ output: Uint8Array; outref: Uint8Array }>,
): Promise<UtxoView[]> {
  const codec = await getCodec();
  return rows.map((row) => {
    const outRefHex = toHex(row.outref);
    let txId: string | null = null;
    let index: number | null = null;
    try {
      const [id, i] = codec.decodeSingleCbor(row.outref) as [Uint8Array, number | bigint];
      txId = toHex(id);
      index = Number(i);
    } catch {
      // Leave the pair null; outRefHex still identifies the entry.
    }
    try {
      const output = codec.decodeMidgardTxOutput(Buffer.from(row.output));
      return {
        txId,
        index,
        outRefHex,
        value: toValueView(output.value),
        hasDatum: output.datum !== undefined,
        hasScriptRef: output.script_ref !== undefined,
        decodeError: null,
      };
    } catch (err) {
      return {
        txId,
        index,
        outRefHex,
        value: null,
        hasDatum: false,
        hasScriptRef: false,
        decodeError: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

/** Decode a bare Midgard-native value CBOR (e.g. withdrawal_utxos.l2_value). */
export async function decodeValueSafe(
  valueCbor: Uint8Array,
): Promise<ValueView | null> {
  try {
    const codec = await getCodec();
    return toValueView(codec.decodeMidgardValue(Buffer.from(valueCbor)));
  } catch {
    return null;
  }
}

export type SafeDecode =
  | { transaction: TransactionView; error: null }
  | { transaction: null; error: string };

/**
 * Decode without throwing — for list/multi contexts (a block's txs, an address
 * history) where one undecodable tx must not fail the whole response.
 */
export async function decodeTransactionSafe(txBytes: Uint8Array): Promise<SafeDecode> {
  try {
    return { transaction: await decodeTransaction(txBytes), error: null };
  } catch (err) {
    return {
      transaction: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
