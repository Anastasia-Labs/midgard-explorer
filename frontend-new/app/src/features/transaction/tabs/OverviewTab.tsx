import Link from "next/link";
import type { MintView, TransactionWithMeta } from "@midgard-explorer/contracts";
import { AddressLink } from "../../../components/ui/domain/address";
import { ValueCell } from "../../../components/ui/domain/amount";
import { AssetName, AssetQuantity } from "../../../components/ui/domain/asset";
import { Detail } from "../../../components/ui/base/detail";
import { Identifier } from "../../../components/ui/domain/identifier";
import { Card, Chip } from "../../../components/ui/base/layout";
import { SemanticLabel } from "../../../components/ui/base/semantic";
import { StatusBadge } from "../../../components/ui/domain/status";
import { assetUnit } from "../../../lib/asset";
import { formatTimestamp } from "../../../lib/format";
import { CredentialDetails, EvidenceHash, EvidenceList, validityIntervalText } from "./shared";

/** The default tab: what the ledger recorded about this transaction that is not
 * the movement itself.
 *
 * It absorbed the former Details tab. That tab held one card with four fields,
 * and a tab a reader has to open to find four hashes is a tab that hides them.
 */

function networkText(networkId: number | null): string {
  if (networkId === null) return "Not declared";
  if (networkId === 0) return "0 (testnet)";
  if (networkId === 1) return "1 (mainnet)";
  return String(networkId);
}

/** Supply change, with the sign that says which direction.
 *
 * The quantities were indexed, carried in the payload, and then reduced to a
 * list of policy IDs under a caption promising the numbers appeared on the
 * outputs in the flow. They do not. A burn removes supply and reaches no
 * output at all, and for a mint an output carries the resulting total rather
 * than the change, so a reader following that caption found a different number.
 */
function MintPanel({ mint }: { mint: MintView }) {
  const assets = [...mint.assets].sort(
    (a, b) => a.policyId.localeCompare(b.policyId) || a.assetName.localeCompare(b.assetName),
  );
  const burns = assets.filter((asset) => BigInt(asset.quantity) < 0n).length;
  const mints = assets.length - burns;

  return (
    <Card>
      <h2 className="mg-overline px-4 pt-4">
        <SemanticLabel
          kind="mintBurn"
          label={
            burns === 0
              ? `Minted (${mints})`
              : mints === 0
                ? `Burned (${burns})`
                : `Minted and burned (${assets.length})`
          }
        />
      </h2>
      {assets.length === 0 ? (
        <div className="p-4">
          <p className="mg-caption text-text-3">
            Quantities could not be decoded. The policies below are what the transaction declared.
          </p>
          <ul className="mt-2 space-y-1">
            {mint.policyIds.map((policyId) => (
              <li key={policyId}>
                <Identifier value={policyId} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {assets.map((asset) => {
            const quantity = BigInt(asset.quantity);
            const burned = quantity < 0n;
            return (
              <li
                key={`${asset.policyId}-${asset.assetName}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/asset/${assetUnit(asset.policyId, asset.assetName)}`}
                    className="min-w-0 text-link hover:text-link-hover hover:underline"
                  >
                    <AssetName nameHex={asset.assetName} />
                  </Link>
                  <div className="mt-1">
                    <Identifier value={asset.policyId} head={12} tail={8} />
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-2 text-sm">
                  <Chip on="surface-2" emphasis="strong">
                    {burned ? "Burn" : "Mint"}
                  </Chip>
                  {/* The sign is the fact. A burn written as an unsigned number
                      reads as new supply. */}
                  <AssetQuantity quantity={burned ? asset.quantity : `+${asset.quantity}`} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
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
          <Detail label="Time" value={formatTimestamp(tx.timestamp)} />
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

      {tx.mint && (tx.mint.assets.length > 0 || tx.mint.policyIds.length > 0) ? (
        <MintPanel mint={tx.mint} />
      ) : null}

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
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <AddressLink address={r.resolved.address} kind={r.resolved.addressKind} />
                      <ValueCell value={r.resolved.value} />
                    </div>
                    <CredentialDetails identity={r.resolved.identity} />
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

      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-body font-semibold text-text">Authorization and commitments</h2>
        </div>
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
      </Card>
    </div>
  );
}
