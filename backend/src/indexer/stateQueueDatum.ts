import { CANONICAL_HASH28, CANONICAL_HASH32 } from "../utils";
// The state queue datum is the block header Midgard commits to L1. Koios hands
// it back as decoded Plutus JSON: { fields: [...] } for constructors, and
// { bytes } or { int } for leaves. The header is positional: exactly 19 leaves
// in a specific order, each with a known type.

export type BlockHeaderFields = {
  prevUtxosRoot: string;
  utxosRoot: string;
  withdrawalsRoot: string;
  forcedTransactionsRoot: string;
  transactionsRoot: string;
  depositsRoot: string;
  transitionTraceRoot: string;
  eventToStepRoot: string;
  withdrawalCount: bigint;
  forcedTransactionCount: bigint;
  l2TransactionCount: bigint;
  depositCount: bigint;
  totalEventCount: bigint;
  transitionStepCount: bigint;
  startTime: bigint;
  endTime: bigint;
  prevHeaderHash: string;
  operatorVkey: string;
  protocolVersion: bigint;
};

type PlutusNode = { fields?: unknown[]; bytes?: string; int?: number | string };

const ROOT_HEX = CANONICAL_HASH32;
const KEY_HASH_HEX = CANONICAL_HASH28;

/** Depth-first walk to the first node holding a flat list of leaves. The header
 * sits several constructors deep and the nesting has changed between versions,
 * so we search for the shape instead of hardcoding a path. */
function findLeafList(node: unknown): PlutusNode[] | null {
  if (node === null || typeof node !== "object") return null;
  const n = node as PlutusNode;
  if (!Array.isArray(n.fields)) return null;

  const children = n.fields as PlutusNode[];
  const leaves = children.filter(
    (c) => c && typeof c === "object" && ("bytes" in c || "int" in c),
  );
  if (leaves.length >= 19) return children;

  for (const child of children) {
    const found = findLeafList(child);
    if (found) return found;
  }
  return null;
}

export function decodeStateQueueDatum(
  datumValue: unknown,
): BlockHeaderFields | null {
  const leaves = findLeafList(datumValue);
  if (!leaves || leaves.length !== 19) return null;

  const validate = {
    bytes64: (l: unknown): string | null => {
      const node = l as PlutusNode;
      return typeof node.bytes === "string" && ROOT_HEX.test(node.bytes)
        ? node.bytes
        : null;
    },
    bigint: (l: unknown): bigint | null => {
      const node = l as PlutusNode;
      return node.int !== undefined ? BigInt(node.int as number | string) : null;
    },
    bytes28: (l: unknown): string | null => {
      const node = l as PlutusNode;
      return typeof node.bytes === "string" && KEY_HASH_HEX.test(node.bytes)
        ? node.bytes
        : null;
    },
  };

  const prevUtxosRoot = validate.bytes64(leaves[0]);
  const utxosRoot = validate.bytes64(leaves[1]);
  const withdrawalsRoot = validate.bytes64(leaves[2]);
  const forcedTransactionsRoot = validate.bytes64(leaves[3]);
  const transactionsRoot = validate.bytes64(leaves[4]);
  const depositsRoot = validate.bytes64(leaves[5]);
  const transitionTraceRoot = validate.bytes64(leaves[6]);
  const eventToStepRoot = validate.bytes64(leaves[7]);

  const withdrawalCount = validate.bigint(leaves[8]);
  const forcedTransactionCount = validate.bigint(leaves[9]);
  const l2TransactionCount = validate.bigint(leaves[10]);
  const depositCount = validate.bigint(leaves[11]);
  const totalEventCount = validate.bigint(leaves[12]);
  const transitionStepCount = validate.bigint(leaves[13]);

  const startTime = validate.bigint(leaves[14]);
  const endTime = validate.bigint(leaves[15]);

  const prevHeaderHash = validate.bytes28(leaves[16]);
  const operatorVkey = validate.bytes28(leaves[17]);

  const protocolVersion = validate.bigint(leaves[18]);

  if (
    !prevUtxosRoot || !utxosRoot || !withdrawalsRoot || !forcedTransactionsRoot ||
    !transactionsRoot || !depositsRoot || !transitionTraceRoot || !eventToStepRoot ||
    withdrawalCount === null || forcedTransactionCount === null ||
    l2TransactionCount === null || depositCount === null ||
    totalEventCount === null || transitionStepCount === null ||
    startTime === null || endTime === null ||
    !prevHeaderHash || !operatorVkey ||
    protocolVersion === null
  ) {
    return null;
  }

  return {
    prevUtxosRoot,
    utxosRoot,
    withdrawalsRoot,
    forcedTransactionsRoot,
    transactionsRoot,
    depositsRoot,
    transitionTraceRoot,
    eventToStepRoot,
    withdrawalCount,
    forcedTransactionCount,
    l2TransactionCount,
    depositCount,
    totalEventCount,
    transitionStepCount,
    startTime,
    endTime,
    prevHeaderHash,
    operatorVkey,
    protocolVersion,
  };
}
