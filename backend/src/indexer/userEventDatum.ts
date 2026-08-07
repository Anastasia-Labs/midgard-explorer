// Deposit and withdrawal datums, decoded positionally against the Aiken types
// in midgard/onchain/aiken/lib/midgard/user-events/. Positional, not
// shape-searching: an earlier decoder in this codebase searched for a list of
// the right length, matched the wrong list, and mislabelled all eight of its
// fields while passing every test it had.

type Node = {
  constructor?: number;
  fields?: unknown[];
  bytes?: string;
  int?: number | string;
};

const HASH32 = /^[0-9a-f]{64}$/;
const HASH28 = /^[0-9a-f]{56}$/;

const asNode = (v: unknown): Node | null =>
  v !== null && typeof v === "object" ? (v as Node) : null;

/** A constructor node with exactly `n` fields. Exact, not "at least": a
 * different arity means a different type, and accepting it is how a decoder
 * ends up confidently reporting the wrong thing. */
function ctor(v: unknown, index: number, n: number): unknown[] | null {
  const node = asNode(v);
  if (!node || !Array.isArray(node.fields)) return null;
  // `constructor` is inherited from Object.prototype on every plain object, so
  // a plain `node.constructor` read on a leaf returns the Object function
  // rather than undefined. Ask for an OWN property, or this compares a
  // function to a number and only works by accident.
  if (!Object.hasOwn(node, "constructor")) return null;
  if (node.constructor !== index) return null;
  return node.fields.length === n ? node.fields : null;
}

function bytes(v: unknown, re: RegExp): string | null {
  const node = asNode(v);
  return node && typeof node.bytes === "string" && re.test(node.bytes) ? node.bytes : null;
}

function int(v: unknown): bigint | null {
  const node = asNode(v);
  if (!node || node.int === undefined || node.bytes !== undefined) return null;
  try {
    return BigInt(node.int);
  } catch {
    return null;
  }
}

/** OutputReference { transaction_id: ByteArray, output_index: Int }. */
function outRef(v: unknown): { txHash: string; index: number } | null {
  const f = ctor(v, 0, 2);
  if (!f) return null;
  const txHash = bytes(f[0], HASH32);
  const index = int(f[1]);
  return txHash !== null && index !== null ? { txHash, index: Number(index) } : null;
}

/** Credential is a one-field constructor: 0 = verification key, 1 = script.
 * Only the hash is kept, since that is what identifies the party. */
function credential(v: unknown): string | null {
  const asVkey = ctor(v, 0, 1);
  const asScript = asVkey ? null : ctor(v, 1, 1);
  const f = asVkey ?? asScript;
  return f ? bytes(f[0], HASH28) : null;
}

/** Address { payment_credential, stake_credential: Option<Referenced<...>> }.
 * The stake side nests Some > Inline > Credential, so it is three constructors
 * deep before the hash. An absent stake credential is not an error. */
function address(v: unknown): { payment: string; stake: string | null } | null {
  const f = ctor(v, 0, 2);
  if (!f) return null;
  const payment = credential(f[0]);
  if (payment === null) return null;

  const some = ctor(f[1], 0, 1);
  if (!some) return ctor(f[1], 1, 0) ? { payment, stake: null } : null;
  const inline = ctor(some[0], 0, 1);
  if (!inline) return null;
  return { payment, stake: credential(inline[0]) };
}

export type DepositFields = {
  l1OutRef: { txHash: string; index: number };
  l2PaymentCredential: string;
  l2StakeCredential: string | null;
  l2NetworkId: number;
  hasL2Datum: boolean;
  inclusionTime: bigint;
  witness: string;
};

/** deposit.Datum { event: DepositEvent, inclusion_time, witness }.
 *
 * Note this is NOT user_events.OptimisticDatum: the deposit type has three
 * fields and carries no refund_address or refund_datum. Anchored on a datum
 * read from preprod on 2026-08-07, not inferred from the type alone.
 *
 * The amount is deliberately absent. A deposit's value is the event UTxO's own
 * value, which the indexer stores on l1_event.lovelace, so reading an amount
 * from the datum would be reading a field that does not exist.
 */
export function decodeDepositDatum(v: unknown): DepositFields | null {
  const top = ctor(v, 0, 3);
  if (!top) return null;

  const event = ctor(top[0], 0, 2);
  if (!event) return null;

  const l1OutRef = outRef(event[0]);
  if (!l1OutRef) return null;

  const info = ctor(event[1], 0, 3);
  if (!info) return null;

  const l2 = address(info[0]);
  const l2NetworkId = int(info[1]);
  if (!l2 || l2NetworkId === null) return null;

  // Option<Data>: constructor 0 is Some, constructor 1 is None.
  const hasL2Datum = ctor(info[2], 0, 1) !== null;
  if (!hasL2Datum && ctor(info[2], 1, 0) === null) return null;

  const inclusionTime = int(top[1]);
  const witness = bytes(top[2], HASH28);
  if (inclusionTime === null || witness === null) return null;

  return {
    l1OutRef,
    l2PaymentCredential: l2.payment,
    l2StakeCredential: l2.stake,
    l2NetworkId: Number(l2NetworkId),
    hasL2Datum,
    inclusionTime,
    witness,
  };
}

export type WithdrawalFields = {
  l1OutRef: { txHash: string; index: number };
  l2OutRef: { txHash: string; index: number };
  l2Owner: string;
  inclusionTime: bigint;
  witness: string;
};

/** withdrawal.Datum = user_events.OptimisticDatum<WithdrawalEvent>, five
 * fields: event, inclusion_time, witness, refund_address, refund_datum.
 *
 * UNVERIFIED against real data. There are no withdrawal events on preprod as
 * of 2026-08-07, so this is written from withdrawal.ak and ledger-state.ak
 * alone. It returns null on any mismatch, which surfaces as an undecoded event
 * rather than as a wrong one. Re-anchor it against a real datum before
 * trusting its output.
 */
export function decodeWithdrawalDatum(v: unknown): WithdrawalFields | null {
  const top = ctor(v, 0, 5);
  if (!top) return null;

  const event = ctor(top[0], 0, 2);
  if (!event) return null;

  const l1OutRef = outRef(event[0]);
  if (!l1OutRef) return null;

  // WithdrawalInfo { body, signature, validity }
  const info = ctor(event[1], 0, 3);
  if (!info) return null;

  // WithdrawalBody { l2_outref, l2_owner, l2_value, l1_address, l1_datum }
  const body = ctor(info[0], 0, 5);
  if (!body) return null;

  const l2OutRef = outRef(body[0]);
  const l2Owner = bytes(body[1], HASH28);
  const inclusionTime = int(top[1]);
  const witness = bytes(top[2], HASH28);
  if (!l2OutRef || l2Owner === null || inclusionTime === null || witness === null) return null;

  return { l1OutRef, l2OutRef, l2Owner, inclusionTime, witness };
}

/** A validator family plus its datum becomes a named event. `unknown` means the
 * datum did not decode, never that the event has no meaning: a decoder that
 * cannot prove the shape returns null instead of guessing. */
export function classifyEvent(
  family: string,
  datum: unknown,
): { eventType: string; decoded: Record<string, unknown> | null } {
  if (family === "deposit") {
    const d = decodeDepositDatum(datum);
    // inclusionTime is a bigint and JSON.stringify throws on one, so it
    // crosses into the Json column as a decimal string.
    return d
      ? { eventType: "deposit", decoded: { ...d, inclusionTime: d.inclusionTime.toString() } }
      : { eventType: "unknown", decoded: null };
  }
  if (family === "withdrawal") {
    const d = decodeWithdrawalDatum(datum);
    return d
      ? { eventType: "withdrawal", decoded: { ...d, inclusionTime: d.inclusionTime.toString() } }
      : { eventType: "unknown", decoded: null };
  }
  return { eventType: "unknown", decoded: null };
}
