import type { TransactionView } from "@midgard-explorer/contracts";
import { AssetHierarchy, ValueCell } from "../../../components/ui/domain/amount";
import { AddressRecord } from "../../../components/ui/domain/addressrecord";
import { Icon } from "../../../components/ui/base/icons";
import { Identifier } from "../../../components/ui/domain/identifier";
import { Card, Chip, Callout } from "../../../components/ui/base/layout";
import { ReferenceScript } from "../../../components/ui/domain/scriptdata";
import { SemanticLabel, SemanticValue } from "../../../components/ui/base/semantic";
import { OutputState } from "./shared";
import { UtxoFlow } from "../../../components/ui/domain/utxoflow";
import { BalanceChanges } from "../../../components/ui/domain/ledger";
import { ledgerEquation } from "../../../lib/ledger";
import { ViewToggle } from "../../../components/ui/base/viewtoggle";

/** What the transaction changed: the same inputs and
 * outputs as either a complete table or a summarising diagram.
 *
 * Extracted from the route so the page resolves data and composes tabs while
 * each tab owns its own sections. The route file had grown past 700 lines with
 * five tabs' worth of presentation inlined in its body. */
export function StateTab({ tx, proposed = false }: { tx: TransactionView; proposed?: boolean }) {
  const utxoTable = (
    <>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <Card>
          <h2 className="mg-overline px-4 pt-4">
            <SemanticLabel kind="input" label={`Inputs (${tx.inputs.length})`} />
          </h2>
          <ul className="space-y-3 p-4">
            {tx.inputs.map((input) => (
              <li
                key={`${input.txId}-${input.index}`}
                className="rounded-lg border border-border bg-surface-2/40 p-3"
              >
                <Identifier
                  value={`${input.txId}#${input.index}`}
                  href={`/transaction/${input.txId}`}
                />
                {input.resolved ? (
                  <>
                    <div className="mt-2">
                      <AddressRecord
                        address={input.resolved.address}
                        identity={input.resolved.identity}
                        utxo={{
                          txId: input.txId,
                          index: input.index,
                          value: input.resolved.value,
                          context: "Input",
                        }}
                      >
                        <ValueCell value={input.resolved.value} />
                      </AddressRecord>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-text-3">Input details unavailable.</p>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <div className="hidden items-center text-page-copy lg:flex">
          <Icon name="arrowRight" size={20} />
        </div>

        <Card>
          <h2 className="mg-overline px-4 pt-4">
            <SemanticLabel kind="output" label={`Outputs (${tx.outputs.length})`} />
          </h2>
          <ul className="space-y-3 p-4">
            {tx.outputs.map((output) => (
              <li
                key={output.index}
                // Neutral by default: an accent on every output encodes nothing.
                // Accent is reserved for something provable (belongs to the
                // viewed address, carries a mint, holds a datum or script ref).
                className="rounded-lg border border-border bg-surface-2/40 p-3"
              >
                <AddressRecord
                  address={output.address}
                  identity={output.identity}
                  utxo={{
                    txId: tx.txId,
                    index: output.index,
                    value: output.value,
                    context: "Output",
                    status: <OutputState output={output} />,
                  }}
                >
                  <ValueCell value={output.value} />
                </AddressRecord>
                {/* The reference and "Unspent" are in the UTxO preview beside the
                    address. What stays visible is what the reader acts on: where
                    the output went, or a warning about its state. */}
                {output.state.consumedBy || output.state.status !== "unspent" ? (
                  <div className="mt-2 flex justify-end">
                    <OutputState output={output} />
                  </div>
                ) : null}
                {output.hasDatum ? (
                  <div className="mt-1.5 flex gap-1.5">
                    <Chip>
                      <SemanticValue kind="datum">datum</SemanticValue>
                    </Chip>
                  </div>
                ) : null}
                {/* The reference script was a chip reading "script ref". Its
                    hash, language and bytes were all in the payload and none of
                    them reached the page. */}
                {output.scriptRef ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer mg-caption text-link">
                      Reference script
                    </summary>
                    <ReferenceScript script={output.scriptRef} />
                  </details>
                ) : null}
                {Object.keys(output.value.assets).length > 0 ? (
                  <div className="mt-2 border-t border-border pt-2">
                    <AssetHierarchy assets={output.value.assets} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );

  return (
    <>
      {/* The answer to "what changed?" first, then the records it comes from.
          An invalid transaction's outputs never become ledger state, so its
          arithmetic would describe a change that did not happen. */}
      {tx.validity === "TxIsValid" ? (
        <section aria-labelledby="balance-changes" className="mb-6">
          <h2 id="balance-changes" className="mb-3 text-lg font-semibold tracking-tight">
            Balance changes
          </h2>
          <BalanceChanges tx={tx} proposed={proposed} />
        </section>
      ) : null}
      <section aria-labelledby="transaction-movement" className="mb-6">
        {ledgerEquation(tx).kind === "unbalanced" ? (
          <Callout tone="warning" title="Amounts do not balance">
            A value may not have decoded correctly. Check the raw response before relying on these
            amounts.
          </Callout>
        ) : null}
        <ViewToggle
          heading={
            <h2 id="transaction-movement" className="text-lg font-semibold tracking-tight">
              Inputs &amp; outputs
            </h2>
          }
          label="UTxO view"
          views={[
            { id: "table", label: "Table", content: utxoTable },
            { id: "flow", label: "Flow", content: <UtxoFlow tx={tx} /> },
          ]}
        />
      </section>
    </>
  );
}
