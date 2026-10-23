// SpendRedeemer and AdvancingApproach, from
// midgard/onchain/aiken/lib/midgard/scheduler.ak.
//
// The redeemer is where a scheduler transaction says what it did. The datum
// only says what the schedule became, which is why a summary built from the
// datum alone can name the current operator but never the operation.
//
// Read at query time rather than at ingest. There is no decoded column on
// l1_redeemer, and adding one would cost a migration plus a full re-index to
// populate rows whose raw redeemer we already store verbatim.
//
// Field counts are exact throughout. Several approach constructors are nothing
// but lists of Ints, so a decoder that accepted "at least n" fields would
// happily report an end-of-shift advance for a skipped-operator rewind.
// Confirmed against live preprod tx c934b1a4...46e10 on 2026-08-14, which
// decodes to rewindEndOfShift.

type Node = { constructor?: number; fields?: unknown[]; int?: number | string };

const asNode = (v: unknown): Node | null =>
  v !== null && typeof v === "object" ? (v as Node) : null;

/** A constructor node with exactly `n` fields.
 *
 * Deliberately a local copy of the helper in `indexer/userEventDatum.ts` rather
 * than an import. That one is tuned to its own file's exactness rules, and
 * sharing it across a module boundary invites the loosening that would break
 * both decoders at once. */
function ctor(v: unknown, index: number, n: number): unknown[] | null {
  const node = asNode(v);
  if (!node || !Array.isArray(node.fields)) return null;
  // `constructor` is inherited from Object.prototype on every plain object, so
  // this has to be an OWN property read. A plain `node.constructor` on a leaf
  // returns the Object function and compares it against a number.
  if (!Object.hasOwn(node, "constructor")) return null;
  if (node.constructor !== index) return null;
  return node.fields.length === n ? node.fields : null;
}

function int(v: unknown): number | null {
  const node = asNode(v);
  if (!node || node.int === undefined) return null;
  const n = Number(node.int);
  return Number.isSafeInteger(n) ? n : null;
}

/** What the scheduler passed over when it skipped an operator. `none` is a
 * real answer; a shape we cannot prove is not. */
export type NeglectedEvent =
  | { kind: "none" }
  | { kind: "deposit" | "withdrawal" | "txOrder"; refInputIndex: number };

/** One per AdvancingApproach constructor. The advance/rewind split is the fact
 * a reader most needs: an advance moves to the next operator in the set, a
 * rewind wraps back to the first. */
export type SchedulerAction =
  | { action: "advanceEndOfShift" }
  | { action: "rewindEndOfShift" }
  | { action: "advanceSkippedOperator"; neglected: NeglectedEvent }
  | { action: "rewindSkippedOperator"; neglected: NeglectedEvent }
  | { action: "advanceOperatorRemoval"; reason: "retirement" | "slashing" }
  | { action: "rewindOperatorRemoval"; reason: "retirement" | "slashing" }
  | { action: "appointFirstOperator" };

const NEGLECTED_KINDS = ["deposit", "withdrawal", "txOrder"] as const;

function neglected(v: unknown): NeglectedEvent | null {
  if (ctor(v, 0, 0)) return { kind: "none" };
  for (const [offset, kind] of NEGLECTED_KINDS.entries()) {
    // NoNeglectedUserEvent is constructor 0, so the payload-carrying ones start
    // at 1 and stay in declaration order.
    const fields = ctor(v, offset + 1, 1);
    if (!fields) continue;
    const refInputIndex = int(fields[0]);
    return refInputIndex === null ? null : { kind, refInputIndex };
  }
  return null;
}

function removalReason(v: unknown): "retirement" | "slashing" | null {
  if (ctor(v, 0, 0)) return "retirement";
  if (ctor(v, 1, 0)) return "slashing";
  return null;
}

function approach(v: unknown): SchedulerAction | null {
  if (ctor(v, 0, 1)) return { action: "advanceEndOfShift" };
  if (ctor(v, 1, 3)) return { action: "rewindEndOfShift" };

  const skippedAdvance = ctor(v, 2, 6);
  if (skippedAdvance) {
    const event = neglected(skippedAdvance[5]);
    return event === null ? null : { action: "advanceSkippedOperator", neglected: event };
  }

  const skippedRewind = ctor(v, 3, 7);
  if (skippedRewind) {
    const event = neglected(skippedRewind[6]);
    return event === null ? null : { action: "rewindSkippedOperator", neglected: event };
  }

  const removalAdvance = ctor(v, 4, 2);
  if (removalAdvance) {
    const reason = removalReason(removalAdvance[1]);
    return reason === null ? null : { action: "advanceOperatorRemoval", reason };
  }

  const removalRewind = ctor(v, 5, 4);
  if (removalRewind) {
    // Third field, not second: RewindDueToOperatorRemoval carries an optional
    // last-node index before the reason.
    const reason = removalReason(removalRewind[2]);
    return reason === null ? null : { action: "rewindOperatorRemoval", reason };
  }

  if (ctor(v, 6, 2)) return { action: "appointFirstOperator" };
  return null;
}

/** Null means the explorer cannot yet prove which operation this was, never
 * that the transaction did nothing. */
export function decodeSchedulerRedeemer(v: unknown): SchedulerAction | null {
  const spend = ctor(v, 0, 3);
  return spend ? approach(spend[2]) : null;
}
