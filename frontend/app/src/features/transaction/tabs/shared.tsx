import type { OutputView, TransactionView } from "@midgard-explorer/contracts";
import { Identifier } from "../../../components/ui/domain/identifier";
import { SemanticValue } from "../../../components/ui/base/semantic";

export function OutputState({ output }: { output: OutputView }) {
  if (output.state.consumedBy) {
    return (
      <SemanticValue kind="consumedBy" className="mg-caption text-text-2">
        <span>Consumed by</span>
        <Identifier
          value={`${output.state.consumedBy.txId}#${output.state.consumedBy.index}`}
          href={`/transaction/${output.state.consumedBy.txId}`}
          head={8}
          tail={6}
        />
      </SemanticValue>
    );
  }
  const style =
    output.state.status === "unspent"
      ? "bg-success/10 text-success"
      : output.state.status === "not_in_current_ledger"
        ? "bg-warning/10 text-warning"
        : "bg-surface-2 text-text-3";
  const label =
    output.state.status === "unspent"
      ? "Unspent"
      : output.state.status === "not_in_current_ledger"
        ? "Not in current ledger"
        : "State not checked";
  return <span className={`rounded px-2 py-0.5 text-micro font-medium ${style}`}>{label}</span>;
}

/** Reads as a phrase rather than a pair of slots joined by a glyph, and each
 * open-ended case says which side is open. */
export function validityIntervalText(interval: TransactionView["validityInterval"]): string {
  const { start, end } = interval;
  if (start !== null && end !== null) return `Slots ${start} to ${end}`;
  if (start !== null) return `From slot ${start}`;
  if (end !== null) return `Until slot ${end}`;
  return "Unbounded";
}
