import type { AddressIdentityView, OutputView, TransactionView } from "@midgard-explorer/contracts";
import { Chip } from "../../../components/ui/primitives";
import { Identifier } from "../../../components/ui/identifier";
import { Detail } from "../../../components/ui/detail";
import { SemanticLabel, SemanticValue } from "../../../components/ui/semantic";
import type { SemanticIconKind } from "../../../lib/semantic-icons";

/** Presentational pieces shared by the transaction tabs.
 *
 * `CredentialDetails` and `OutputState` are used by both State and Details, so
 * neither tab can own them; the rest live here for the same reason the tabs do,
 * which is that the route file should compose tabs rather than contain them. */

export function CredentialDetails({ identity }: { identity: AddressIdentityView }) {
  return (
    <details className="mt-2 border-t border-border pt-2">
      <summary className="cursor-pointer mg-caption text-link">Credentials</summary>
      <dl className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <Detail
          label="Payment credential"
          semantic="paymentCredential"
          value={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Identifier value={identity.payment.hash} head={10} tail={8} />
              <Chip>{identity.payment.kind === "Script" ? "script" : "key"}</Chip>
            </span>
          }
        />
        <Detail
          label="Stake credential"
          semantic="stakeCredential"
          value={
            identity.stake ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Identifier value={identity.stake.hash} head={10} tail={8} />
                <Chip>{identity.stake.kind === "Script" ? "script" : "key"}</Chip>
              </span>
            ) : (
              "None"
            )
          }
        />
      </dl>
      <p className="mt-1 mg-micro text-text-3">
        Network {identity.networkId}
        {identity.protected ? " · protected address" : ""}
      </p>
    </details>
  );
}

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
