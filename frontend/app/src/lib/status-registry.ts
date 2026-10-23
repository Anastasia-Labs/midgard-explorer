/** Single authoritative status registry. Badges, callouts, legends, steppers
 * and explanations all read from here: colors carry protocol meaning, so
 * there must be exactly one mapping.
 *
 * Codes verified against the node's CHECK constraints:
 *   database/txAdmissions.ts               tx lifecycle
 *   database/deposits.ts                   awaiting | projected | consumed
 *   database/withdrawals.ts                awaiting | projected | finalized + 8 validity codes
 *   database/forcedTransactions.ts         awaiting | projected | finalized, and the
 *                                          verdict in forced_inclusion_value
 *   database/pendingBlockFinalizations.ts  6 finalization statuses
 *
 * Midgard migration 0011 renamed the terminal `finalized` to `locally_applied`.
 * The backend now derives `waiting_to_merge`, `merged` and `finalized` for an
 * applied block from the follower's tables; `finalized` is also what an older
 * node writes itself. The six forced-transaction codes stay for
 * the `operator_validity` column an older node still has.
 *
 * Tone semantics (docs/redesign-prompt.md:111-128):
 *   info    - active, in progress
 *   warning - genuinely waiting, not yet final
 *   success - settled
 *   danger  - terminal failure
 *   neutral - inert or unrecognized
 */
export type StatusTone = "info" | "warning" | "success" | "danger" | "neutral";

export type StatusKind =
  | "tx_lifecycle"
  | "bridge_status"
  | "finalization"
  | "tx_validity"
  | "withdrawal_validity"
  | "forced_validity";

export type StatusEntry = {
  kind: StatusKind;
  tone: StatusTone;
  label: string;
  explain: string;
};

const e = (kind: StatusKind, tone: StatusTone, label: string, explain: string): StatusEntry => ({
  kind,
  tone,
  label,
  explain,
});

export const STATUS_REGISTRY: Record<string, StatusEntry> = {
  // --- transaction lifecycle -------------------------------------------
  queued: e(
    "tx_lifecycle",
    "neutral",
    "Queued",
    "Received by the node and waiting for validation. It can still be rejected before entering the mempool.",
  ),
  validating: e(
    "tx_lifecycle",
    "info",
    "Validating",
    "Being checked by the node right now. It has not yet been accepted or included in a block.",
  ),
  accepted: e(
    "tx_lifecycle",
    "info",
    "Accepted",
    "Validated and admitted to the mempool. It can still be dropped or rejected before block inclusion.",
  ),
  pending_commit: e(
    "tx_lifecycle",
    "warning",
    "Pending commit",
    "Processed and waiting to be merged into a Midgard block. It is not yet part of the ledger history.",
  ),
  committed: e(
    "tx_lifecycle",
    // In a block, not yet final: in progress, not concluded. A check here
    // read as settled beside a Cardano column that said otherwise.
    "info",
    "Committed",
    "Included in a Midgard block. Reversible until that block is final on Cardano.",
  ),
  rejected: e(
    "tx_lifecycle",
    "danger",
    "Rejected",
    "Failed validation and will not be included. A corrected transaction must be submitted under a new hash.",
  ),

  // --- bridge event status ---------------------------------------------
  awaiting: e(
    "bridge_status",
    "warning",
    "Awaiting",
    "Observed on Cardano, waiting for its inclusion window. It has not yet changed the Midgard ledger.",
  ),
  projected: e(
    "bridge_status",
    "info",
    "Projected",
    "Reflected in the Midgard ledger; the containing block is not final on Cardano yet. The projected effect can still be reversed.",
  ),
  consumed: e(
    "bridge_status",
    "info",
    "Consumed",
    // `bridge_status` is shared by deposits, withdrawals and forced
    // transactions, so this names the event UTxO rather than the deposit one.
    "The event's Cardano UTxO was consumed and its effect is in the Midgard ledger. Final once the containing block settles.",
  ),

  // --- block finalization ----------------------------------------------
  pending_submission: e(
    "finalization",
    "neutral",
    "Pending submission",
    "The node has not submitted the finalization transaction to Cardano yet. Every transaction in this block remains reversible.",
  ),
  submitted_local_finalization_pending: e(
    "finalization",
    "info",
    "Submitted (local pending)",
    "Finalization submitted; the node's local confirmation is still pending. Do not treat the block as settled yet.",
  ),
  submitted_unconfirmed: e(
    "finalization",
    "info",
    "Submitted (unconfirmed)",
    "The node reports the finalization submitted to Cardano and not yet confirmed. The submission may still fail or be replaced.",
  ),
  observed_waiting_stability: e(
    "finalization",
    "warning",
    "Awaiting stability",
    "The node reports seeing it on Cardano and is waiting for the required chain-stability depth. A short rollback could still remove it.",
  ),
  // `locally_applied` is the node's own code; the other three are derived
  // from the node's follower tables by the backend (db/settlement.ts).
  locally_applied: e(
    "finalization",
    "neutral",
    "Merge not recorded",
    "The node applied this block. Its place in the state queue is not recorded yet.",
  ),
  waiting_to_merge: e(
    "finalization",
    "warning",
    "Waiting to merge",
    "In the state queue on Cardano. After merging, it still waits for the Cardano rollback window to pass before finality.",
  ),
  merged: e(
    "finalization",
    "info",
    "Merged",
    "Merged into the confirmed state. A Cardano rollback could still undo it.",
  ),
  // Sent by the public source, which reads no settlement record at all.
  not_observed: e(
    "finalization",
    "neutral",
    "Not observed",
    "This explorer reads its archive of block payloads, not Cardano or the node's records. It cannot say where this block is in settlement.",
  ),
  finalized: e("finalization", "success", "Finalized", "Final. Midgard treats it as permanent."),
  abandoned: e(
    "finalization",
    "danger",
    "Abandoned",
    "The node abandoned this block's finalization, so it has not settled. The node can revive it if its commit later lands on Cardano, but never one a correction removed.",
  ),

  // --- transaction validity --------------------------------------------
  TxIsValid: e(
    "tx_validity",
    "success",
    "Valid",
    "The transaction passed validation. Its state change applies if the containing block remains in the chain.",
  ),
  TxIsInvalid: e(
    "tx_validity",
    "danger",
    "Invalid",
    "The transaction failed validation. Its ordinary outputs do not become spendable ledger state.",
  ),

  // --- withdrawal validity (8 codes) -----------------------------------
  WithdrawalIsValid: e(
    "withdrawal_validity",
    "success",
    "Valid",
    "The withdrawal passed validation. It may proceed to projection and Cardano settlement.",
  ),
  NonExistentWithdrawalUtxo: e(
    "withdrawal_validity",
    "danger",
    "Non-existent UTxO",
    "The referenced Midgard UTxO does not exist. No value can be withdrawn from that reference.",
  ),
  SpentWithdrawalUtxo: e(
    "withdrawal_validity",
    "danger",
    "Spent UTxO",
    "The referenced Midgard UTxO was already spent. Reusing it would be a double spend, so the withdrawal cannot proceed.",
  ),
  IncorrectWithdrawalOwner: e(
    "withdrawal_validity",
    "danger",
    "Wrong owner",
    "The withdrawal is not signed by the owner of the UTxO. The node will not authorize its payout.",
  ),
  IncorrectWithdrawalValue: e(
    "withdrawal_validity",
    "danger",
    "Wrong value",
    "The withdrawal value does not match the referenced UTxO. The request must be corrected before it can proceed.",
  ),
  IncorrectWithdrawalSignature: e(
    "withdrawal_validity",
    "danger",
    "Bad signature",
    "The withdrawal signature is invalid. Ownership has not been proven, so the withdrawal cannot proceed.",
  ),
  TooManyTokensInWithdrawal: e(
    "withdrawal_validity",
    "danger",
    "Too many tokens",
    "The withdrawal exceeds the permitted token count. Split or reduce the value before submitting another request.",
  ),
  UnpayableWithdrawalValue: e(
    "withdrawal_validity",
    "danger",
    "Unpayable value",
    "The value cannot be paid out on Cardano. Its amount or asset bundle must be changed to form a valid output.",
  ),

  // --- forced-transaction operator verdict ------------------------------
  ForcedTxValid: e(
    "forced_validity",
    "success",
    "Valid",
    "The operator judged the forced transaction valid. Its state change applies if the block carrying it remains in the chain.",
  ),
  ForcedTxInvalid: e(
    "forced_validity",
    "danger",
    "Invalid",
    "The operator judged the forced transaction invalid, for the reason shown beside it. Its requested state change is not applied.",
  ),

  // --- forced-transaction operator validity, an older node (6 codes) -----
  NonExistentInputUtxo: e(
    "forced_validity",
    "danger",
    "Non-existent input",
    "An input UTxO referenced by the forced transaction does not exist. The forced transaction cannot be applied.",
  ),
  InvalidSignature: e(
    "forced_validity",
    "danger",
    "Invalid signature",
    "A required signature on the forced transaction is invalid. The claimed authorization is not accepted.",
  ),
  FailedScript: e(
    "forced_validity",
    "danger",
    "Script failed",
    "A Plutus script in the forced transaction failed to validate. Its requested state transition cannot be applied.",
  ),
  FeeTooLow: e(
    "forced_validity",
    "danger",
    "Fee too low",
    "The forced transaction's fee is below the required minimum. It must pay a sufficient fee under the active parameters.",
  ),
  UnbalancedTx: e(
    "forced_validity",
    "danger",
    "Unbalanced",
    "The forced transaction's inputs and outputs do not balance. It would create or destroy unaccounted value, so it is rejected.",
  ),
};

/** `TxIsValid` is shared by tx validity and forced-tx operator validity;
 * `finalized` is shared by block finalization and bridge event status. The
 * legend needs each under both kinds. */
const LEGEND_ALIASES: Partial<Record<StatusKind, string[]>> = {
  forced_validity: ["TxIsValid"],
  bridge_status: ["finalized"],
};

export type ResolvedStatus = StatusEntry & { known: boolean };

export function statusOf(status: string): ResolvedStatus {
  const known = STATUS_REGISTRY[status];
  if (known) return { ...known, known: true };
  return {
    kind: "tx_lifecycle",
    tone: "neutral",
    label: status,
    explain:
      "The backend reported a status this explorer does not recognize. Treat it as unresolved and inspect the raw response before relying on it.",
    known: false,
  };
}

/** Codes the explorer sends that no node stores, so no list can filter on them. */
const EXPLORER_CODES = new Set(["not_observed"]);

/** The statuses a list can filter by: the node's own codes. */
export function filterOptionsFor(kind: StatusKind): Array<{ value: string; label: string }> {
  return legendFor(kind)
    .filter((e) => !EXPLORER_CODES.has(e.code))
    .map((e) => ({ value: e.code, label: e.label }));
}

export function legendFor(kind: StatusKind): Array<StatusEntry & { code: string }> {
  const direct = Object.entries(STATUS_REGISTRY)
    .filter(([, v]) => v.kind === kind)
    .map(([code, v]) => ({ code, ...v }));
  const aliases = (LEGEND_ALIASES[kind] ?? []).flatMap((code) => {
    const entry = STATUS_REGISTRY[code];
    return entry ? [{ code, ...entry }] : [];
  });
  return [...direct, ...aliases];
}
