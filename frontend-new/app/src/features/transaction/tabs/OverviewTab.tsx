import type { TransactionWithMeta } from "@midgard-explorer/contracts";
import { AddressRecord } from "../../../components/ui/domain/addressrecord";
import { ValueCell } from "../../../components/ui/domain/amount";
import { Detail } from "../../../components/ui/base/detail";
import { Identifier } from "../../../components/ui/domain/identifier";
import { Card } from "../../../components/ui/base/layout";
import { SemanticLabel } from "../../../components/ui/base/semantic";
import { StatusBadge } from "../../../components/ui/domain/status";
import { EvidenceHash, EvidenceList, validityIntervalText } from "./shared";

/** Ledger metadata and script evidence, separate from the movement overview. */

function networkText(networkId: number | null): string {
  if (networkId === null) return "Not declared";
  if (networkId === 0) return "0 (testnet)";
  if (networkId === 1) return "1 (mainnet)";
  return String(networkId);
}

export function OverviewTab({ tx }: { tx: TransactionWithMeta }) {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mg-overline px-4 pt-4">Technical details</h2>
        {/* Fee, inputs and outputs are in the record header above and are not
            repeated here. */}
        <dl className="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Whether the ledger applied this transaction, which is a different
              question from where it is in its lifecycle. It reads as a field
              here rather than as a second badge beside the lifecycle status,
              where two badges answered one question with two words. */}
          <Detail label="Validity" value={<StatusBadge status={tx.validity} />} />
          <Detail
            label="Validity interval"
            term="validityInterval"
            value={validityIntervalText(tx.validityInterval)}
            {...(tx.validityInterval.start === null && tx.validityInterval.end === null
              ? {}
              : { hint: "The ledger accepts this transaction only inside this slot range." })}
          />
          <Detail label="Network ID" term="networkId" value={networkText(tx.networkId)} />
          <Detail
            label="Format version"
            term="transactionFormat"
            value={String(tx.formatVersion)}
          />
          <Detail
            label="Witnesses"
            term="witnessSet"
            value={`${tx.witnesses.vkeyCount} vkey · ${tx.witnesses.scriptCount} script · ${tx.witnesses.redeemerCount} redeemer`}
          />
        </dl>
      </Card>

      {tx.referenceInputs.length > 0 ? (
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
                  <>
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
                  </>
                ) : (
                  <p className="mt-2 mg-caption text-text-3">
                    The current ledger cannot resolve this reference input&apos;s value.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <details
        className="rounded-xl border border-border bg-surface"
        open={
          tx.requiredSigners.length > 0 ||
          tx.requiredObservers.length > 0 ||
          tx.scriptIntegrityHash !== null ||
          tx.auxiliaryDataHash !== null
        }
      >
        <summary className="cursor-pointer px-4 py-3 text-body font-semibold text-text">
          Authorization and commitments
        </summary>
        <dl className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-2">
          <EvidenceList
            label="Required signers"
            kind="requiredSigner"
            values={tx.requiredSigners}
            empty="No additional signer hashes declared"
          />
          <EvidenceList
            label="Required observers"
            kind="requiredObserver"
            values={tx.requiredObservers}
            empty="No withdrawal observer scripts declared"
          />
          <EvidenceHash
            label="Script integrity hash"
            kind="script"
            value={tx.scriptIntegrityHash}
          />
          <EvidenceHash label="Auxiliary-data hash" kind="metadata" value={tx.auxiliaryDataHash} />
        </dl>
      </details>
    </div>
  );
}
