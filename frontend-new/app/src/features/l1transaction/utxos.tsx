import type { L1TransactionResponse, L1TxIo } from "../../lib/api";
import { AddressLink } from "../../components/ui/address";
import { AdaAmount } from "../../components/ui/amount";
import { AssetMark, AssetName, AssetQuantity } from "../../components/ui/asset";
import { Detail } from "../../components/ui/detail";
import { Icon } from "../../components/ui/icons";
import { Identifier } from "../../components/ui/identifier";
import { Card, Chip } from "../../components/ui/primitives";
import { SemanticLabel, SemanticValue } from "../../components/ui/semantic";
import type { SemanticIconKind } from "../../lib/semantic-icons";
import { L1_EXPLORER_NAME, l1AddressUrl } from "../../lib/network";

/** What the Cardano transaction moved.
 *
 * The indexer has stored every UTxO of every Midgard-related transaction since
 * it was written, and none of it reached this page: an address was reachable
 * only as text on a list elsewhere, and its payment credential, stake address,
 * UTxO reference and spender were held and never shown.
 */

/** The credential pair, behind the same disclosure the Midgard transaction
 * page uses. Two pages that show the same fact must reveal it the same way, or
 * a reader learns one page's habit and finds nothing on the other. */
function Credentials({ io }: { io: L1TxIo }) {
  if (io.paymentCred === null && io.stakeAddr === null) return null;
  return (
    <details className="mt-2 border-t border-border pt-2">
      <summary className="cursor-pointer mg-caption text-link">Credentials</summary>
      <dl className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <Detail
          label="Payment credential"
          semantic="paymentCredential"
          value={
            io.paymentCred === null ? (
              <span className="text-text-3">Not recorded</span>
            ) : (
              <Identifier value={io.paymentCred} head={10} tail={8} />
            )
          }
        />
        <Detail
          label="Stake address"
          semantic="stakeCredential"
          value={
            io.stakeAddr === null ? (
              /* An enterprise address has no staking part. That is a fact the
                 chain states, not a gap in the index. */
              <span className="text-text-3">None</span>
            ) : (
              <Identifier value={io.stakeAddr} head={12} tail={8} />
            )
          }
        />
      </dl>
    </details>
  );
}

/** Native assets riding on one UTxO.
 *
 * No link. `/asset` is a Midgard asset page, and a Cardano policy that never
 * crossed into Midgard has no entry there, so linking would send a reader to a
 * page that answers "not found" for a token that plainly exists.
 */
function Assets({ assets }: { assets: L1TxIo["assets"] }) {
  if (assets.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
      {assets.map((asset) => (
        <li
          key={`${asset.policyId}${asset.assetName}`}
          className="flex items-center justify-between gap-3"
        >
          <span className="flex min-w-0 items-center gap-2">
            <AssetMark policyId={asset.policyId} nameHex={asset.assetName} size={16} />
            <AssetName nameHex={asset.assetName} />
          </span>
          <span className="shrink-0 text-sm">
            <AssetQuantity quantity={asset.quantity} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Who spent this output, when this index holds the transaction that did.
 *
 * Silence is not "unspent". The index covers Midgard-related transactions, so
 * an output consumed by an unrelated Cardano transaction has no spender here
 * and must not be labelled as still on the ledger. The section says so once,
 * beneath the list, rather than repeating a disclaimer on every row.
 */
function ConsumedBy({ spentBy }: { spentBy: string | null | undefined }) {
  if (spentBy === null || spentBy === undefined) return null;
  return (
    <SemanticValue kind="consumedBy" className="mg-caption text-text-2">
      <span>Consumed by</span>
      <Identifier value={spentBy} href={`/l1/transaction/${spentBy}`} head={8} tail={6} />
    </SemanticValue>
  );
}

function Utxo({ io, produced }: { io: L1TxIo; produced: boolean }) {
  const externalHref = io.address === null ? null : l1AddressUrl(io.address);
  // An inline datum is a datum whether or not its hash was recorded beside it.
  const hasDatum = io.inlineDatum !== null || io.datumHash !== null;
  return (
    <li className="rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {io.address === null ? (
          <span className="mg-caption text-text-3">Address not recorded</span>
        ) : (
          <AddressLink
            address={io.address}
            chain="cardano"
            head={10}
            tail={8}
            {...(externalHref === null
              ? {}
              : {
                  href: externalHref,
                  external: true,
                  externalLabel: `View this address on ${L1_EXPLORER_NAME ?? "the Cardano explorer"}`,
                })}
          />
        )}
        <AdaAmount lovelace={io.lovelace} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <SemanticValue kind="utxo" className="mg-caption text-text-2">
          <Identifier
            value={`${io.sourceTxHash}#${io.sourceIndex}`}
            /* An input names the transaction that produced it, which is a page
               worth reaching. An output names this transaction, so linking it
               would point the reader at the page they are already on. */
            {...(produced ? {} : { href: `/l1/transaction/${io.sourceTxHash}` })}
            head={8}
            tail={6}
          />
        </SemanticValue>
        {produced ? <ConsumedBy spentBy={io.spentBy} /> : null}
      </div>
      {!hasDatum && io.refScriptHash === null ? null : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!hasDatum ? null : (
            <Chip>
              <SemanticValue kind={io.inlineDatum === null ? "datumHash" : "datum"}>
                {io.inlineDatum === null ? "datum hash" : "inline datum"}
              </SemanticValue>
            </Chip>
          )}
          {io.refScriptHash === null ? null : (
            <Chip>
              <SemanticValue kind="script">reference script</SemanticValue>
            </Chip>
          )}
        </div>
      )}
      <Credentials io={io} />
      <Assets assets={io.assets} />
    </li>
  );
}

function Side({
  label,
  kind,
  ios,
  produced = false,
  empty,
  note,
}: {
  label: string;
  kind: SemanticIconKind;
  ios: readonly L1TxIo[];
  produced?: boolean;
  empty: string;
  note?: string;
}) {
  return (
    <Card>
      <h2 className="mg-overline px-4 pt-4">
        <SemanticLabel kind={kind} label={`${label} (${ios.length})`} />
      </h2>
      {ios.length === 0 ? (
        <p className="px-4 py-3 mg-caption text-text-3">{empty}</p>
      ) : (
        <ul className="space-y-3 p-4">
          {ios.map((io) => (
            <Utxo key={`${io.kind}-${io.position}`} io={io} produced={produced} />
          ))}
        </ul>
      )}
      {note === undefined ? null : (
        <p className="border-t border-border px-4 py-2 mg-micro text-text-3">{note}</p>
      )}
    </Card>
  );
}

const SPENDER_NOTE =
  "A spender is named only where this index holds the transaction that spent the output. " +
  "The index covers Midgard-related transactions, so no spender here does not mean unspent.";

export function L1Utxos({ tx }: { tx: L1TransactionResponse }) {
  const collateralReturn = tx.collateralOutput;
  const hasCollateral = tx.collateral.length > 0 || collateralReturn !== null;
  return (
    <section className="mt-4 space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <Side label="Inputs" kind="input" ios={tx.inputs} empty="No inputs recorded." />
        <div className="hidden items-center text-page-copy lg:flex">
          <Icon name="arrowRight" size={20} />
        </div>
        <Side
          label="Outputs"
          kind="output"
          ios={tx.outputs}
          produced
          empty="No outputs recorded."
          note={SPENDER_NOTE}
        />
      </div>

      {tx.referenceInputs.length === 0 ? null : (
        <Side
          label="Reference inputs"
          kind="referenceInput"
          ios={tx.referenceInputs}
          empty="No reference inputs."
        />
      )}

      {hasCollateral ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Side
            label="Collateral"
            kind="collateral"
            ios={tx.collateral}
            empty="No collateral inputs."
          />
          <Side
            label="Collateral return"
            kind="collateral"
            ios={collateralReturn === null ? [] : [collateralReturn]}
            produced
            empty="No collateral was returned."
          />
        </div>
      ) : null}
    </section>
  );
}
