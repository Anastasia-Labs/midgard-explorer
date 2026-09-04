import { readFileSync } from "node:fs";
import {
  computeMidgardNativeTxId,
  decodeMidgardNativeByteListPreimage,
  decodeMidgardNativeTxFullFromCanonicalCbor,
  decodeMidgardTxOutput,
  encodeCbor,
  encodeMidgardAddressText,
  encodeMidgardNativeTxCanonical,
  encodeMidgardTxOutput,
} from "@al-ft/midgard-core";

/**
 * Builds shaped transactions through the real codec.
 *
 * I8: a seed must not be able to describe a transaction the decoder would
 * reject. Rather than inventing bytes, this decodes the canonical corpus in
 * `test/fixtures/shape-corpus.json`, keeps its parts, reassembles them at the
 * size the profile asks for, and encodes with `encodeMidgardNativeTxCanonical`.
 * The canonical round trip is byte-identical, so what comes out is by
 * construction something the decoder accepts.
 *
 * Size is an outcome, not a dial (I13). The caller asks for inputs, outputs and
 * assets per output; the bytes follow. The one exception is
 * `buildOversizeTx`, which exists to cross `MAX_INLINE_CBOR_BYTES`, a bound the
 * ordinary shapes do not reach.
 */

const CORPUS = "test/fixtures/shape-corpus.json";

/** The `multi-input` entry: two inputs and the smallest outputs in the set. */
const BASE_ENTRY = "4";

type DecodedOutput = ReturnType<typeof decodeMidgardTxOutput>;

export type CorpusParts = {
  version: bigint;
  validity: Parameters<typeof encodeMidgardNativeTxCanonical>[0]["validity"];
  body: ReturnType<typeof decodeMidgardNativeTxFullFromCanonicalCbor>["body"];
  witnessSet: ReturnType<
    typeof decodeMidgardNativeTxFullFromCanonicalCbor
  >["witnessSet"];
  /** One decoded output, used as the template every synthetic output copies. */
  outputTemplate: DecodedOutput;
  /** Encoded spend inputs, cycled when more are asked for than exist. */
  inputTemplates: readonly Buffer[];
  addressLength: number;
  policyId: string;
};

export type ShapedOutput = {
  address: string;
  addressBytes: Uint8Array;
  output: Uint8Array;
};

export type ShapedTx = {
  txId: Uint8Array;
  bytes: Uint8Array;
  outputs: readonly ShapedOutput[];
  inputCount: number;
};

export function loadCorpus(path: string = CORPUS): CorpusParts {
  const corpus = JSON.parse(readFileSync(path, "utf8"));
  const entry = corpus.entries[BASE_ENTRY];
  const full = decodeMidgardNativeTxFullFromCanonicalCbor(
    Buffer.from(entry.canonicalTxHex, "hex"),
  );
  const outputs = decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor);
  const inputs = decodeMidgardNativeByteListPreimage(
    full.body.spendInputsPreimageCbor,
  );
  const outputTemplate = decodeMidgardTxOutput(outputs[0]);
  return {
    version: full.version,
    validity: full.validity,
    body: full.body,
    witnessSet: full.witnessSet,
    outputTemplate,
    inputTemplates: inputs.map((i) => Buffer.from(i)),
    addressLength: Buffer.from(outputTemplate.address).length,
    policyId: corpus.policyId,
  };
}

/**
 * A distinct address per id, derived from the corpus address.
 *
 * The trailing bytes carry the id, which keeps the address structurally valid
 * (the header byte and length are the template's) while giving the dataset the
 * address cardinality the profile asks for. Payment credentials this produces
 * are not real key hashes, and nothing in the explorer treats them as such.
 */
export function addressFor(parts: CorpusParts, id: number): Buffer {
  const address = Buffer.from(parts.outputTemplate.address);
  address.writeUInt32BE(id >>> 0, address.length - 4);
  return address;
}

/**
 * A deterministic policy id for `id`, derived from the corpus policy.
 *
 * The encoder requires exactly 28 bytes, so the last four hex characters carry
 * the id and the length is the template's.
 */
function policyFor(parts: CorpusParts, id: number): string {
  return parts.policyId.slice(0, -4) + (id % 0xffff).toString(16).padStart(4, "0");
}

/** A deterministic asset name for `id`. */
function assetNameFor(id: number): string {
  return id.toString(16).padStart(8, "0");
}

/** Asset names grouped under one policy. Neither one policy for everything nor
 * one policy per asset: both are degenerate for the asset roster, which groups
 * by policy. */
const NAMES_PER_POLICY = 4;

function outputFor(
  parts: CorpusParts,
  addressId: number,
  assetsPerOutput: number,
): ShapedOutput {
  const addressBytes = addressFor(parts, addressId);
  // Nested Maps, not a plain object: `assets` is keyed by policy id, and each
  // policy holds a Map of asset name to amount. An object serialises to `{}`
  // under JSON.stringify, so this shape is invisible when inspecting a decoded
  // output rather than encoding one.
  const assets = new Map<string, Map<string, bigint>>();
  for (let i = 0; i < assetsPerOutput; i += 1) {
    const id = addressId * 31 + i;
    const policy = policyFor(parts, Math.floor(id / NAMES_PER_POLICY));
    const names = assets.get(policy) ?? new Map<string, bigint>();
    names.set(assetNameFor(id), BigInt(1_000 + i));
    assets.set(policy, names);
  }
  const output = Buffer.from(
    encodeMidgardTxOutput({
      ...parts.outputTemplate,
      address: addressBytes,
      value: { ...parts.outputTemplate.value, assets },
    }),
  );
  return {
    address: encodeMidgardAddressText(addressBytes),
    addressBytes,
    output,
  };
}

function assemble(
  parts: CorpusParts,
  outputs: readonly ShapedOutput[],
  inputCount: number,
): ShapedTx {
  const inputs = Array.from({ length: inputCount }, (_, i) =>
    parts.inputTemplates[i % parts.inputTemplates.length],
  );
  const bytes = Buffer.from(
    encodeMidgardNativeTxCanonical({
      version: parts.version,
      validity: parts.validity,
      witnessSet: parts.witnessSet,
      body: {
        ...parts.body,
        spendInputsPreimageCbor: Buffer.from(encodeCbor(inputs)),
        outputsPreimageCbor: Buffer.from(
          encodeCbor(outputs.map((o) => Buffer.from(o.output))),
        ),
      },
    }),
  );
  // Decode what was encoded. This is the property I8 actually asserts, and it
  // costs one decode per transaction to hold it rather than assume it.
  const full = decodeMidgardNativeTxFullFromCanonicalCbor(bytes);
  return {
    txId: computeMidgardNativeTxId(full),
    bytes,
    outputs,
    inputCount,
  };
}

export type TxSpec = {
  inputs: number;
  outputs: number;
  assetsPerOutput: number;
  /** One address id per output. */
  addressIds: readonly number[];
};

export function buildTx(parts: CorpusParts, spec: TxSpec): ShapedTx {
  const count = Math.max(1, spec.outputs);
  const outputs = Array.from({ length: count }, (_, i) =>
    outputFor(
      parts,
      spec.addressIds[i % Math.max(1, spec.addressIds.length)] ?? i,
      spec.assetsPerOutput,
    ),
  );
  return assemble(parts, outputs, Math.max(1, spec.inputs));
}

/**
 * A transaction strictly larger than `minBytes`.
 *
 * Grows the output count until the encoded size clears the bound. The ordinary
 * shapes top out near 6 KB, so this is the only thing in the dataset that
 * exercises `cborTruncated`, and `>` rather than `>=` is the point: sized
 * exactly on the cap, nothing truncates.
 */
export function buildOversizeTx(
  parts: CorpusParts,
  minBytes: number,
  addressBase = 900_000,
): ShapedTx {
  let count = Math.max(2, Math.ceil(minBytes / 64));
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const tx = buildTx(parts, {
      inputs: 2,
      outputs: count,
      assetsPerOutput: 0,
      addressIds: Array.from({ length: count }, (_, i) => addressBase + i),
    });
    if (tx.bytes.length > minBytes) return tx;
    count = Math.ceil(count * 1.4);
  }
  throw new Error(`could not build a transaction over ${minBytes} bytes`);
}
