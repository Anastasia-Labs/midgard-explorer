import { isKnownTxStatus } from "@midgard-explorer/contracts";
import { cn } from "../../lib/format";

/** Status to tone + label + plain-English explanation.
 * Unknown values render verbatim with a neutral tone: never silently mapped.
 *
 * NOTE (recovery 2026-07-30): this map duplicates `lib/status-registry.ts` and
 * disagrees with it on `pending_commit`, `validating`, `observed_waiting_stability`
 * and `awaiting`. The registry is the corrected source; this map is what the
 * badges actually render. Restored as-is so the recovery matches the build it
 * came from; the migration to the registry is a separate change. */
type Tone = "success" | "info" | "warning" | "danger" | "neutral";
type StatusMeta = { tone: Tone; label: string; explain: string };

const STATUS_MAP: Record<string, StatusMeta> = {
  committed: { tone: "success", label: "Committed", explain: "Included in a Midgard block." },
  pending_commit: {
    tone: "info",
    label: "Pending commit",
    explain: "Processed and waiting to be merged into a block.",
  },
  accepted: { tone: "info", label: "Accepted", explain: "Validated and admitted to the mempool." },
  validating: { tone: "warning", label: "Validating", explain: "Being checked by the node." },
  queued: { tone: "neutral", label: "Queued", explain: "Waiting for validation." },
  rejected: { tone: "danger", label: "Rejected", explain: "Failed validation." },

  // Bridge event statuses (node database/{deposits,withdrawals,forcedTransactions}.ts)
  awaiting: {
    tone: "neutral",
    label: "Awaiting",
    explain: "Observed on L1, waiting for its inclusion window.",
  },
  consumed: {
    tone: "success",
    label: "Consumed",
    explain: "Deposit UTxO spent into the L2 ledger.",
  },

  // Block finalization statuses (node database/pendingBlockFinalizations.ts)
  pending_submission: {
    tone: "neutral",
    label: "Pending submission",
    explain: "Finalization transaction not yet submitted to L1.",
  },
  submitted_local_finalization_pending: {
    tone: "info",
    label: "Submitted (local pending)",
    explain: "Finalization submitted; local confirmation pending.",
  },
  submitted_unconfirmed: {
    tone: "info",
    label: "Submitted (unconfirmed)",
    explain: "Finalization submitted to L1, not yet confirmed.",
  },
  observed_waiting_stability: {
    tone: "info",
    label: "Awaiting stability",
    explain: "Seen on L1; waiting for chain stability depth.",
  },
  abandoned: {
    tone: "danger",
    label: "Abandoned",
    explain: "Finalization attempt abandoned; the block did not settle.",
  },

  // Tx validity (decode layer)
  TxIsValid: { tone: "success", label: "Valid", explain: "Transaction passed validation." },
  TxIsInvalid: { tone: "danger", label: "Invalid", explain: "Transaction failed validation." },

  // Withdrawal validity codes (node database/withdrawals.ts, 8 codes)
  WithdrawalIsValid: { tone: "success", label: "Valid", explain: "Withdrawal passed validation." },
  NonExistentWithdrawalUtxo: {
    tone: "danger",
    label: "Non-existent UTxO",
    explain: "The referenced L2 UTxO does not exist.",
  },
  SpentWithdrawalUtxo: {
    tone: "danger",
    label: "Spent UTxO",
    explain: "The referenced L2 UTxO was already spent.",
  },
  IncorrectWithdrawalOwner: {
    tone: "danger",
    label: "Wrong owner",
    explain: "The withdrawal is not signed by the UTxO owner.",
  },
  IncorrectWithdrawalValue: {
    tone: "danger",
    label: "Wrong value",
    explain: "The withdrawal value does not match the UTxO.",
  },
  IncorrectWithdrawalSignature: {
    tone: "danger",
    label: "Bad signature",
    explain: "The withdrawal signature is invalid.",
  },
  TooManyTokensInWithdrawal: {
    tone: "danger",
    label: "Too many tokens",
    explain: "The withdrawal exceeds the token-count limit.",
  },
  UnpayableWithdrawalValue: {
    tone: "danger",
    label: "Unpayable value",
    explain: "The value cannot be paid out on L1.",
  },

  projected: {
    tone: "info",
    label: "Projected",
    explain: "Reflected in the L2 ledger, not yet finalized on L1.",
  },
  finalized: { tone: "success", label: "Finalized", explain: "Settled on L1." },
};

export function statusOf(status: string): StatusMeta {
  const known = STATUS_MAP[status];
  if (known) return known;
  return {
    tone: "neutral",
    label: status,
    explain: "Unrecognized status reported by the backend.",
  };
}

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/30",
  info: "bg-info/10 text-info border-info/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  neutral: "bg-surface-2 text-text-2 border-border-strong",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { tone, label } = statusOf(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
      title={statusOf(status).explain}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
      {!isKnownTxStatus(status) && status in STATUS_MAP === false ? (
        <span className="sr-only">(unrecognized status)</span>
      ) : null}
    </span>
  );
}
