import type { BlockFinalization, TxAdmission, TxInclusion } from "@midgard-explorer/contracts";
import { statusOf } from "./status-registry";

/** Normalized presentation model for a record's path through the protocol.
 *
 * This is a view model, not a wire contract: the API keeps returning the domain
 * records (`TxAdmission`, `TxInclusion`, `BlockFinalization`), and this adapts
 * them. Raw tabs and evidence stay reachable, so nothing here can hide what the
 * node actually said.
 *
 * Rules the adapter must never break, enforced by test/journey.test.ts:
 *   - a timestamp appears only where a source field records one
 *   - a failed branch never renders as reached
 *   - settlement stages never appear before inclusion
 *   - "Final" appears only for the protocol's terminal success state
 *   - an unrecognized status is shown verbatim, never mapped to a known stage
 */

export type JourneyStageState = "reached" | "current" | "future" | "failed" | "unknown";

export type TimestampKind = "recorded" | "not_recorded" | "not_applicable";

export type JourneySource = "tx_admissions" | "blocks" | "pending_block_finalizations" | "bridge";

export type JourneyStage = {
  key: string;
  label: string;
  /** False for stages that are evidence rather than milestones. They stay in
   * the details grid; keeping them on the rail pushed it past a phone's width,
   * and a clipped rail reads as a broken journey. */
  rail?: boolean;
  state: JourneyStageState;
  occurredAt: string | null;
  timestampKind: TimestampKind;
  source: JourneySource;
  evidence?: { blockHeight?: number; blockHash?: string; l1TxHash?: string };
};

export type JourneyOutcome = "active" | "complete" | "failed" | "unknown";

export type JourneyModel = {
  kind: "transaction" | "block" | "deposit" | "withdrawal";
  outcome: JourneyOutcome;
  headline: string;
  explanation: string;
  stages: JourneyStage[];
  rawStatus: string;
};

/** Lifecycle statuses that mean the node stopped working on the transaction. */
const TERMINAL_FAILURES = new Set(["rejected"]);

/** The only finalization status that means settled on L1. */
const L1_TERMINAL_SUCCESS = "finalized";

/** Finalization statuses that mean the node gave up. */
const L1_TERMINAL_FAILURE = "abandoned";

const stage = (
  key: string,
  label: string,
  state: JourneyStageState,
  source: JourneySource,
  occurredAt: string | null,
  timestampKind: TimestampKind,
  evidence?: JourneyStage["evidence"],
  rail = true,
): JourneyStage => ({
  key,
  label,
  state,
  rail,
  occurredAt,
  timestampKind,
  source,
  ...(evidence ? { evidence } : {}),
});

/** The rail carries milestones only; everything else remains in the details. */
export const railStages = (stages: JourneyStage[]): JourneyStage[] =>
  stages.filter((s) => s.rail !== false);

/** A recorded value becomes a timestamp; anything else is explicitly absent, so
 * the renderer can say which kind of absent it is rather than printing nothing. */
const recorded = (value: string | null, applicable: boolean): [string | null, TimestampKind] =>
  value !== null ? [value, "recorded"] : [null, applicable ? "not_recorded" : "not_applicable"];

function admissionStages(
  admission: TxAdmission | null,
  failed: boolean,
  pastAdmission: boolean,
): JourneyStage[] {
  if (admission === null) {
    // No admission record at all: say so rather than inventing a start.
    return [
      stage(
        "received",
        "Received",
        pastAdmission ? "reached" : "unknown",
        "tx_admissions",
        null,
        "not_recorded",
      ),
    ];
  }

  const [firstSeen, firstSeenKind] = recorded(admission.firstSeenAt, true);
  const [validationStarted, validationKind] = recorded(admission.validationStartedAt, true);
  const [terminal, terminalKind] = recorded(admission.terminalAt, true);

  const received = stage(
    "received",
    "Received",
    "reached",
    "tx_admissions",
    firstSeen,
    firstSeenKind,
  );

  const validatingState: JourneyStageState =
    validationStarted === null ? (failed ? "future" : "current") : failed ? "failed" : "reached";
  const validating = stage(
    "validated",
    failed ? "Rejected" : "Validated",
    validatingState,
    "tx_admissions",
    failed ? terminal : validationStarted,
    failed ? terminalKind : validationKind,
  );

  if (failed) return [received, validating];

  const accepted = stage(
    "accepted",
    "Accepted",
    terminal === null ? "current" : "reached",
    "tx_admissions",
    terminal,
    terminalKind,
    undefined,
    false,
  );
  return [received, validating, accepted];
}

/** How much of the L1 half belongs on the rail.
 *
 * `compact` is for a transaction, where settlement is the tail of a longer
 * story and the rail has already spent its width on admission. `full` is for a
 * block, whose entire story is settlement, so the intermediate L1 stages earn
 * their place on the rail rather than sitting behind the disclosure. */
type L1Detail = "compact" | "full";

/** The L1 half of any journey. Kept separate from inclusion so a block, which
 * is its own inclusion, never has to fabricate a transaction-shaped record to
 * reuse it. */
function l1Stages(finalization: BlockFinalization | null, detail: L1Detail): JourneyStage[] {
  if (finalization === null) {
    return [
      stage("final", "Final on L1", "future", "pending_block_finalizations", null, "not_recorded"),
    ];
  }

  const known = statusOf(finalization.status).known;
  const evidence = finalization.submitted_tx_hash
    ? { l1TxHash: finalization.submitted_tx_hash }
    : undefined;
  const [queued, queuedKind] = recorded(finalization.createdAt, true);

  // The node records when finalization was queued but never when the L1
  // transaction was handed to the network, so submission is evidenced by the
  // transaction hash rather than by a time.
  const queuedStage = stage(
    "queued_for_l1",
    "Queued for L1",
    "reached",
    "pending_block_finalizations",
    queued,
    queuedKind,
    undefined,
    false,
  );

  // An unrecognized settlement status is appended verbatim. Mapping it onto the
  // nearest known stage would assert protocol knowledge we do not have.
  if (!known) {
    const [seen, seenKind] = recorded(finalization.observedConfirmedAt, true);
    return [
      queuedStage,
      stage(
        "unknown_settlement",
        finalization.status,
        "unknown",
        "pending_block_finalizations",
        seen,
        seenKind,
        evidence,
      ),
    ];
  }

  const isFinal = finalization.status === L1_TERMINAL_SUCCESS;
  const isAbandoned = finalization.status === L1_TERMINAL_FAILURE;
  const [observed, observedKind] = recorded(finalization.observedConfirmedAt, true);
  const onRail = detail === "full";

  const submitted = stage(
    "submitted",
    "Submitted to L1",
    finalization.submitted_tx_hash ? "reached" : isAbandoned ? "failed" : "future",
    "pending_block_finalizations",
    null,
    "not_recorded",
    evidence,
    onRail,
  );

  const seenOnL1 = stage(
    "seen_on_l1",
    "Seen on L1",
    observed !== null ? "reached" : isAbandoned ? "failed" : "future",
    "pending_block_finalizations",
    observed,
    observedKind,
    evidence,
    onRail,
  );

  const final = stage(
    "final",
    isAbandoned ? "Abandoned" : "Final on L1",
    isFinal ? "reached" : isAbandoned ? "failed" : "current",
    "pending_block_finalizations",
    // `updatedAt` is the settlement transition's own timestamp; it only stands
    // for the terminal stage once the block actually reached one.
    isFinal || isAbandoned ? finalization.updatedAt : null,
    isFinal || isAbandoned ? "recorded" : "not_recorded",
    evidence,
  );

  return [queuedStage, submitted, seenOnL1, final];
}

/** Inclusion plus settlement, for a record that lives inside a block. */
function settlementStages(
  inclusion: TxInclusion | null,
  finalization: BlockFinalization | null,
): JourneyStage[] {
  // Settlement is only meaningful once a block carries the record, so an
  // absent inclusion makes every later stage not applicable rather than late.
  if (inclusion === null) {
    return [
      stage("included", "In a block", "future", "blocks", null, "not_applicable"),
      stage(
        "final",
        "Final on L1",
        "future",
        "pending_block_finalizations",
        null,
        "not_applicable",
      ),
    ];
  }
  return [
    stage(
      "included",
      `Block #${inclusion.height}`,
      "reached",
      "blocks",
      inclusion.time_stamp_tz,
      "recorded",
      { blockHeight: inclusion.height, blockHash: inclusion.header_hash },
    ),
    ...l1Stages(finalization, "compact"),
  ];
}

export function transactionJourney(input: {
  status: string;
  admission: TxAdmission | null;
  inclusion: TxInclusion | null;
  finalization: BlockFinalization | null;
}): JourneyModel {
  const { status, admission, inclusion, finalization } = input;
  const resolved = statusOf(status);
  const failed = TERMINAL_FAILURES.has(status);
  const settled = finalization?.status === L1_TERMINAL_SUCCESS;
  const abandoned = finalization?.status === L1_TERMINAL_FAILURE;

  const stages = failed
    ? admissionStages(admission, true, false)
    : [
        ...admissionStages(admission, false, inclusion !== null),
        ...settlementStages(inclusion, finalization),
      ];

  // An unrecognized stage anywhere makes the whole outcome unknown. Reporting
  // "active" around a stage we cannot interpret would assert progress we have
  // no basis for.
  const hasUnknownStage = stages.some((s) => s.state === "unknown");

  const outcome: JourneyOutcome = failed
    ? "failed"
    : abandoned
      ? "failed"
      : hasUnknownStage || !resolved.known
        ? "unknown"
        : settled
          ? "complete"
          : "active";

  const headline = failed
    ? "Rejected by the node"
    : hasUnknownStage
      ? "Settlement stage not recognized"
      : settled
        ? "Final on Cardano L1"
        : abandoned
          ? "Finalization abandoned"
          : inclusion !== null
            ? "Committed, awaiting L1 finality"
            : resolved.label;

  const explanation = failed
    ? "The node rejected this transaction, so it was never included in an L2 block."
    : hasUnknownStage
      ? "The node reported a settlement stage this explorer does not recognize, so its finality cannot be stated here. The raw status is shown as reported."
      : settled
        ? "The block carrying this transaction is settled on Cardano L1."
        : abandoned
          ? "The node stopped trying to finalize the block carrying this transaction."
          : inclusion !== null
            ? "Reversible until the block carrying it becomes final on Cardano L1."
            : resolved.explain;

  return { kind: "transaction", outcome, headline, explanation, stages, rawStatus: status };
}

/** How far along a record is, for a list row that has room for a status code
 * and nothing else.
 *
 * A badge names the state; it does not say whether that state is early or
 * nearly done. Two codes a reader has not memorized are indistinguishable
 * without this. The step counts come from the same protocol ordering the full
 * journey uses, so a row and the record it links to can never disagree. */
export type JourneyProgress = {
  step: number;
  total: number;
  state: "active" | "complete" | "failed" | "unknown";
  label: string;
};

const PROGRESS_ORDER: Record<string, number> = {
  // Transaction lifecycle: received, validated, accepted, in a block.
  queued: 1,
  validating: 2,
  accepted: 3,
  pending_commit: 3,
  committed: 4,
  // Block finalization: queued, submitted, seen on L1, final.
  pending_submission: 1,
  submitted_local_finalization_pending: 2,
  submitted_unconfirmed: 2,
  observed_waiting_stability: 3,
  finalized: 4,
  // Bridge events: observed on L1, projected into the ledger, settled.
  awaiting: 1,
  projected: 2,
  consumed: 4,
};

const PROGRESS_FAILURES = new Set(["rejected", "abandoned"]);

const PROGRESS_TOTAL = 4;

export function journeyProgress(status: string): JourneyProgress {
  const resolved = statusOf(status);
  if (PROGRESS_FAILURES.has(status)) {
    return { step: 0, total: PROGRESS_TOTAL, state: "failed", label: resolved.label };
  }
  const step = PROGRESS_ORDER[status];
  if (step === undefined) {
    // An unrecognized code has no position in the ordering, and guessing one
    // would put a reader further along than the node ever said they were.
    return { step: 0, total: PROGRESS_TOTAL, state: "unknown", label: resolved.label };
  }
  return {
    step,
    total: PROGRESS_TOTAL,
    state: step === PROGRESS_TOTAL ? "complete" : "active",
    label: resolved.label,
  };
}

export function blockJourney(finalization: BlockFinalization | null, height: number): JourneyModel {
  // A block is its own inclusion, so it composes the closed stage with the L1
  // stages directly rather than borrowing a transaction's shape.
  const [closedAt, closedKind] = recorded(finalization?.blockEndTime ?? null, true);
  const stages = [
    stage("closed", `Block #${height}`, "reached", "blocks", closedAt, closedKind),
    ...l1Stages(finalization, "full"),
  ];

  const resolved = finalization === null ? null : statusOf(finalization.status);
  const settled = finalization?.status === L1_TERMINAL_SUCCESS;
  const abandoned = finalization?.status === L1_TERMINAL_FAILURE;
  const hasUnknownStage = stages.some((s) => s.state === "unknown");

  const outcome: JourneyOutcome = settled
    ? "complete"
    : abandoned
      ? "failed"
      : hasUnknownStage || !resolved?.known
        ? "unknown"
        : "active";

  // The headline answers "is this block final?" rather than restating the
  // status code, which the badge beside the title already carries.
  const headline = settled
    ? "Final on Cardano L1"
    : abandoned
      ? "Finalization abandoned"
      : finalization === null
        ? "No finalization record yet"
        : hasUnknownStage
          ? "Settlement stage not recognized"
          : "Committed, awaiting L1 finality";

  return {
    kind: "block",
    outcome,
    headline,
    explanation:
      finalization === null
        ? "The node has not recorded a finalization attempt for this block yet, so this block is not yet on its way to Cardano L1."
        : settled
          ? "This block and every transaction in it are settled on Cardano L1 and can no longer be reversed."
          : hasUnknownStage
            ? "The node reported a settlement stage this explorer does not recognize, so this block's finality cannot be stated here. The raw status is shown as reported."
            : (resolved?.explain ??
              "The node reported a settlement stage this explorer does not recognize."),
    stages,
    rawStatus: finalization?.status ?? "none",
  };
}
