import type { TransactionWithMeta } from "@midgard-explorer/contracts";
import type { ReactNode } from "react";
import { AddressRecord } from "../../../components/ui/domain/addressrecord";
import { ValueCell } from "../../../components/ui/domain/amount";
import { Card } from "../../../components/ui/base/layout";
import { FactGroup as Group, FactRow } from "../../../components/ui/base/facts";
import { Identifier } from "../../../components/ui/domain/identifier";
import { SemanticLabel } from "../../../components/ui/base/semantic";
import { StatusBadge } from "../../../components/ui/domain/status";
import { validityIntervalText } from "./shared";

function networkText(networkId: number): string {
  if (networkId === 0) return "0 (testnet)";
  if (networkId === 1) return "1 (mainnet)";
  return String(networkId);
}

function Hashes({ values }: { values: readonly string[] }) {
  return (
    <ul className="space-y-1">
      {values.map((value) => (
        <li key={value}>
          <Identifier value={value} head={10} tail={8} />
        </li>
      ))}
    </ul>
  );
}

/** The transaction's secondary facts in three named groups.
 *
 * Optional declarations the transaction does not make are left out, rather
 * than listed as "Not declared". Values that answer something, an unbounded
 * interval or a zero witness count, stay. `settlement` is supplied by the
 * route, which holds the settlement records. */
export function DetailsTab({ tx, settlement }: { tx: TransactionWithMeta; settlement: ReactNode }) {
  const bounded = tx.validityInterval.start !== null || tx.validityInterval.end !== null;
  return (
    <Card>
      <Group title="Validation">
        {/* Whether the ledger applied this transaction, which is a different
            question from where it is in its lifecycle. */}
        <FactRow label="Validity">
          <StatusBadge status={tx.validity} />
        </FactRow>
        <FactRow label="Validity interval" term="validityInterval">
          {validityIntervalText(tx.validityInterval)}
          {bounded ? (
            <span className="block mg-caption text-text-3">
              The ledger accepts this transaction only inside this slot range.
            </span>
          ) : null}
        </FactRow>
        {tx.networkId === null ? null : (
          <FactRow label="Network ID" term="networkId">
            {networkText(tx.networkId)}
          </FactRow>
        )}
        <FactRow label="Format version" term="transactionFormat">
          {String(tx.formatVersion)}
        </FactRow>
      </Group>

      <Group title="Authorization and commitments">
        <FactRow label="Witnesses" term="witnessSet">
          {`${tx.witnesses.vkeyCount} vkey · ${tx.witnesses.scriptCount} script · ${tx.witnesses.redeemerCount} redeemer`}
        </FactRow>
        {tx.requiredSigners.length > 0 ? (
          <FactRow label="Required signers">
            <Hashes values={tx.requiredSigners} />
          </FactRow>
        ) : null}
        {tx.requiredObservers.length > 0 ? (
          <FactRow label="Required observers">
            <Hashes values={tx.requiredObservers} />
          </FactRow>
        ) : null}
        {tx.scriptIntegrityHash === null ? null : (
          <FactRow label="Script integrity hash">
            <Identifier value={tx.scriptIntegrityHash} head={10} tail={8} />
          </FactRow>
        )}
        {tx.auxiliaryDataHash === null ? null : (
          <FactRow label="Auxiliary-data hash">
            <Identifier value={tx.auxiliaryDataHash} head={10} tail={8} />
          </FactRow>
        )}
      </Group>

      <Group title="Settlement">{settlement}</Group>
    </Card>
  );
}

/** Outputs a script read without spending them. They belong with the scripts
 * that read them. */
export function ReferenceInputs({ tx }: { tx: TransactionWithMeta }) {
  if (tx.referenceInputs.length === 0) return null;
  return (
    <Card>
      <h2 className="mg-overline px-4 pt-4">
        <SemanticLabel
          kind="referenceInput"
          label={`Reference inputs (${tx.referenceInputs.length})`}
        />
      </h2>
      <p className="px-4 pt-1 mg-caption text-text-3">Read by scripts without being spent.</p>
      <ul className="space-y-3 p-4">
        {tx.referenceInputs.map((r) => (
          <li
            key={`${r.txId}-${r.index}`}
            className="rounded-lg border border-border bg-surface-2/40 p-3"
          >
            <Identifier value={`${r.txId}#${r.index}`} href={`/transaction/${r.txId}`} />
            {r.resolved ? (
              <div className="mt-2">
                <AddressRecord
                  address={r.resolved.address}
                  identity={r.resolved.identity}
                  utxo={{
                    txId: r.txId,
                    index: r.index,
                    value: r.resolved.value,
                    context: "Reference input",
                  }}
                >
                  <ValueCell value={r.resolved.value} />
                </AddressRecord>
              </div>
            ) : (
              <p className="mt-2 mg-caption text-text-3">
                The current ledger cannot resolve this reference input&apos;s value.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
