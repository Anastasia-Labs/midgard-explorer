import type { OutputView, TransactionView } from "@midgard-explorer/contracts";
import { Chip } from "../../../components/ui/base/layout";
import { Identifier } from "../../../components/ui/domain/identifier";
import { Detail } from "../../../components/ui/base/detail";
import { SemanticLabel, SemanticValue } from "../../../components/ui/base/semantic";
import type { SemanticIconKind } from "../../../lib/semantic-icons";

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
      ? "border-success/35 bg-success/10 text-success"
      : output.state.status === "not_in_current_ledger"
        ? "border-warning/35 bg-warning/10 text-warning"
        : "border-border-strong bg-surface text-text-3";
  const label =
    output.state.status === "unspent"
      ? "Unspent"
      : output.state.status === "not_in_current_ledger"
        ? "Not in current ledger"
        : "State not checked";
  return (
    <span className={`rounded border px-2 py-0.5 text-micro font-medium ${style}`}>{label}</span>
  );
}

export function EvidenceList({
  label,
  kind,
  values,
  empty,
}: {
  label: string;
  kind: SemanticIconKind;
  values: readonly string[];
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="mg-overline">
        <SemanticLabel kind={kind} label={label} />
      </dt>
      <dd className="mt-1">
        {values.length === 0 ? (
          <span className="text-sm text-text-3">{empty}</span>
        ) : (
          <ul className="space-y-1">
            {values.map((value) => (
              <li key={value}>
                <Identifier value={value} head={10} tail={8} />
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

export function EvidenceHash({
  label,
  kind,
  value,
}: {
  label: string;
  kind: SemanticIconKind;
  value: string | null;
}) {
  return (
    <div className="min-w-0">
      <dt className="mg-overline">
        <SemanticLabel kind={kind} label={label} />
      </dt>
      <dd className="mt-1">
        {value === null ? (
          <span className="text-sm text-text-3">Not declared</span>
        ) : (
          <Identifier value={value} head={10} tail={8} />
        )}
      </dd>
    </div>
  );
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
