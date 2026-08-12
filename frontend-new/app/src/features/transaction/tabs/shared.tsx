import type { ReactNode } from "react";
import type {
  AddressIdentityView,
  CapabilityView,
  OutputView,
  TransactionView,
} from "@midgard-explorer/contracts";
import { Identifier } from "../../../components/ui/identifier";
import { Detail } from "../../../components/ui/detail";
import { SemanticLabel, SemanticValue } from "../../../components/ui/semantic";
import type { SemanticIconKind } from "../../../lib/semantic-icons";

/** Presentational pieces shared by the transaction tabs.
 *
 * `CredentialDetails` and `OutputState` are used by both State and Details, so
 * neither tab can own them; the rest live here for the same reason the tabs do,
 * which is that the route file should compose tabs rather than contain them. */

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-border bg-surface px-1.5 py-px text-[11px] text-text-3">
      {children}
    </span>
  );
}

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
    <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${style}`}>{label}</span>
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

const CAPABILITY_LABEL: Record<CapabilityView["state"], string> = {
  available: "Available",
  not_present: "Not present",
  hash_only: "Hash only",
  not_supported: "Not in native format",
  not_emitted: "Not emitted",
  not_indexed: "Not indexed",
  commitment_only: "Commitment only",
};

export function CapabilityRow({
  label,
  kind,
  capability,
}: {
  label: string;
  kind: SemanticIconKind;
  capability: CapabilityView;
}) {
  const positive = capability.state === "available";
  const neutral = capability.state === "not_present";
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[13rem_auto_1fr] sm:items-start">
      <dt className="mg-overline">
        <SemanticLabel kind={kind} label={label} />
      </dt>
      <dd>
        <span
          className={
            positive
              ? "rounded border border-success/35 bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
              : neutral
                ? "rounded border border-border-strong px-2 py-0.5 text-xs font-medium text-text-3"
                : "rounded border border-warning/35 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
          }
        >
          {CAPABILITY_LABEL[capability.state]}
        </span>
      </dd>
      <dd className="text-sm leading-relaxed text-text-2">{capability.reason}</dd>
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
