import type { TransactionView } from "@midgard-explorer/contracts";
import { AssetHierarchy, ValueCell } from "../../../components/ui/amount";
import { AddressLink } from "../../../components/ui/address";
import { Icon } from "../../../components/ui/icons";
import { Identifier } from "../../../components/ui/identifier";
import { LedgerEquation } from "../../../components/ui/ledger";
import { Card } from "../../../components/ui/primitives";
import { SemanticLabel, SemanticValue } from "../../../components/ui/semantic";
import { Chip, CredentialDetails, OutputState } from "./shared";
import { UtxoFlow } from "../../../components/ui/utxoflow";
import { ViewToggle } from "../../../components/ui/viewtoggle";

/** What the transaction changed: the ledger equation, then the same inputs and
 * outputs as either a complete table or a summarising diagram.
 *
 * Extracted from the route so the page resolves data and composes tabs while
 * each tab owns its own sections. The route file had grown past 700 lines with
 * five tabs' worth of presentation inlined in its body. */
export function StateTab({ tx }: { tx: TransactionView }) {
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
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <AddressLink
                        address={input.resolved.address}
                        kind={input.resolved.addressKind}
                      />
                      <ValueCell value={input.resolved.value} />
                    </div>
                    <CredentialDetails identity={input.resolved.identity} />
                  </>
                ) : (
                  <p className="mt-2 text-sm text-text-3">
                    Spend side not resolvable (already spent or pruned).
                  </p>
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
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <AddressLink address={output.address} kind={output.addressKind} />
                  <ValueCell value={output.value} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <Identifier value={`${tx.txId}#${output.index}`} head={10} tail={6} />
                  <OutputState output={output} />
                </div>
                <CredentialDetails identity={output.identity} />
                {output.hasDatum || output.hasScriptRef ? (
                  <div className="mt-1.5 flex gap-1.5">
                    {output.hasDatum ? (
                      <Chip>
                        <SemanticValue kind="datum">datum</SemanticValue>
                      </Chip>
                    ) : null}
                    {output.hasScriptRef ? (
                      <Chip>
                        <SemanticValue kind="script">script ref</SemanticValue>
                      </Chip>
                    ) : null}
                  </div>
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

  const utxoTab = (
    <>
      {/* The equation leads the tab and stays put across both views: two lists
          or a diagram show what the transaction contains, and
          inputs = outputs + fee shows what it did. */}
      <LedgerEquation tx={tx} />
      {/* Table first, and it is the default. It is the complete view: every
          input, every output, every asset. The flow is the summary, and it is
          also what a reader falls back from when the diagram cannot help. */}
      <ViewToggle
        label="UTxO view"
        views={[
          { id: "table", label: "Table", content: utxoTable },
          { id: "flow", label: "Flow", content: <UtxoFlow tx={tx} /> },
        ]}
      />
    </>
  );

  return utxoTab;
}
