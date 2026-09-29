import type { ReactNode } from "react";
import type { AddressIdentityView, OutRef, ValueView } from "@midgard-explorer/contracts";
import { AddressLink } from "./address";
import { ValueCell } from "./amount";
import { Identifier } from "./identifier";
import { InfoTip } from "../base/infotip";
import { SEMANTIC_ICONS } from "../../../lib/semantic-icons";
import type { IconName } from "../base/icons";

/** A payment credential is a key only when it is one. A script is drawn as
 * code, and a kind this explorer does not know yet claims neither. */
const credentialIcon = (kind: string, fallback: IconName): IconName =>
  kind === "Script" ? "script" : kind === "PubKey" ? fallback : "hash";

/** Shared credential inspection for resolved Midgard ledger records. */
export function AddressRecord({
  address,
  identity,
  children,
  utxo,
}: {
  address: string;
  identity: AddressIdentityView;
  children: ReactNode;
  utxo?: OutRef & {
    value: ValueView;
    context: "Input" | "Output" | "Reference input";
    status?: ReactNode;
  };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
      <div className="flex min-w-0 flex-wrap items-center">
        <AddressLink address={address} kind={identity.payment.kind} />
        <span className="inline-flex items-center" role="group" aria-label="Address details">
          {(["payment", "stake"] as const).map((kind) => {
            const credential = identity[kind];
            if (!credential) return null;
            const label = kind === "payment" ? "Payment credential" : "Stake credential";
            const semantic = kind === "payment" ? "paymentCredential" : "stakeCredential";
            return (
              <span key={kind} data-semantic-icon={semantic}>
                <InfoTip
                  icon={
                    kind === "payment"
                      ? credentialIcon(credential.kind, SEMANTIC_ICONS[semantic].icon)
                      : SEMANTIC_ICONS[semantic].icon
                  }
                  triggerLabel={label}
                  subject={label}
                  content={
                    <>
                      <span className="mb-2 block font-medium text-text">
                        {label} · {credential.kind === "PubKey" ? "Key" : credential.kind}
                      </span>
                      <Identifier value={credential.hash} full />
                      <span className="mt-2 block text-text-3">
                        Network {identity.networkId}
                        {identity.protected ? " · protected address" : ""}
                        {identity.stake === null ? " · no stake credential" : ""}
                      </span>
                    </>
                  }
                />
              </span>
            );
          })}
          {utxo ? (
            <span data-semantic-icon="utxo">
              <InfoTip
                icon={SEMANTIC_ICONS.utxo.icon}
                triggerLabel="UTxO"
                subject="UTxO"
                content={
                  <>
                    <span className="mb-2 block font-medium text-text">{utxo.context} UTxO</span>
                    <Identifier
                      value={`${utxo.txId}#${utxo.index}`}
                      href={`/transaction/${utxo.txId}`}
                      full
                    />
                    <span className="mt-2 block">
                      <ValueCell value={utxo.value} />
                    </span>
                    {utxo.status ? <span className="mt-2 block">{utxo.status}</span> : null}
                  </>
                }
              />
            </span>
          ) : null}
        </span>
      </div>
      {children}
    </div>
  );
}
