import type {
  L1Event,
  L1Redeemer,
  L1TransactionResponse,
  L1TxIo,
  L1ValidatorIdentity,
} from "../../lib/api";
import { AdaAmount } from "../../components/ui/amount";
import { AssetMark, AssetName, AssetQuantity } from "../../components/ui/asset";
import { Detail } from "../../components/ui/detail";
import { Identifier } from "../../components/ui/identifier";
import { FieldLabel } from "../../components/ui/infotip";
import { JsonPanel } from "../../components/ui/jsonpanel";
import { Card, EmptyState } from "../../components/ui/primitives";
import { SemanticLabel } from "../../components/ui/semantic";
import { ValidatorLabel, validatorFor } from "../../components/ui/validatorlabel";
import { formatQuantity } from "../../lib/asset";
import { formatTimestamp, groupThousands, truncateId } from "../../lib/format";
import { L1_EXPLORER_NAME, l1TxUrl } from "../../lib/network";
import type { SemanticIconKind } from "../../lib/semantic-icons";

/** The sections a Cardano L1 transaction page is made of.
 *
 * Moved out of the route for the same reason the Midgard transaction tabs
 * were: the route resolves the transaction, handles its error states and
 * composes tabs, and the tabs own their own presentation. */

export function Overview({ tx }: { tx: L1TransactionResponse }) {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mg-overline px-4 pt-4">Ledger details</h2>
        <dl className="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Time" value={formatTimestamp(tx.txTime)} />
          <Detail label="Slot" term="slot" value={groupThousands(String(tx.slot))} />
          <Detail label="Epoch" term="epoch" value={groupThousands(String(tx.epoch))} />
          <Detail label="Block index" value={groupThousands(String(tx.blockIndex))} />
          <Detail
            label="Block hash"
            term="blockHash"
            value={<Identifier value={tx.blockHash} head={10} tail={8} />}
          />
          <Detail
            label="Certificate deposit"
            term="certificateDeposit"
            value={<AdaAmount lovelace={tx.certDeposit} />}
          />
          <Detail
            label="Validity interval"
            term="validityInterval"
            value={validityInterval(tx.invalidBefore, tx.invalidAfter)}
          />
          <Detail label="Contract events" value={String(tx.events.length)} />
          <Detail label="Script executions" value={String(tx.redeemers.length)} />
        </dl>
      </Card>
      {tx.metadata === null ? (
        <EmptyState
          title="No transaction metadata"
          hint="This transaction did not include auxiliary metadata."
        />
      ) : (
        <JsonPanel
          title="Transaction metadata"
          term="metadata"
          semantic="metadata"
          value={tx.metadata}
          variant="full"
        />
      )}
    </div>
  );
}

export function IoSection({
  title,
  kind,
  explanation,
  rows,
  currentHash,
  validators,
}: {
  title: string;
  kind: SemanticIconKind;
  explanation: string;
  rows: readonly L1TxIo[];
  currentHash: string;
  validators: readonly L1ValidatorIdentity[];
}) {
  if (rows.length === 0) {
    return <EmptyState title={`No ${title.toLowerCase()}`} hint={explanation} />;
  }
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-text">
            <SemanticLabel kind={kind} label={title} />
          </h2>
          <p className="mg-caption text-text-3">{explanation}</p>
        </div>
        <span className="font-mono mg-caption text-text-3">{rows.length}</span>
      </div>
      <ol className="space-y-3">
        {rows.map((row) => {
          const knownValidator =
            row.address === null ? null : validatorFor(validators, { address: row.address });
          return (
            <li key={`${row.kind}-${row.position}-${row.sourceTxHash}-${row.sourceIndex}`}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mg-overline">
                      <SemanticLabel
                        label="UTxO reference"
                        kind={
                          row.kind === "reference"
                            ? "referenceInput"
                            : row.kind === "input"
                              ? "input"
                              : row.kind.startsWith("collateral")
                                ? "collateral"
                                : "output"
                        }
                      />
                    </p>
                    {/* Provenance, not Midgard context. The transaction that
                        produced this input is usually an ordinary Cardano
                        transaction we hold nothing about, and sending a reader
                        to our own page for it used to answer with a 404.
                        Delegating is both honest and more useful. */}
                    <Identifier
                      value={`${row.sourceTxHash}#${row.sourceIndex}`}
                      href={
                        row.sourceTxHash === currentHash
                          ? undefined
                          : (l1TxUrl(row.sourceTxHash) ?? undefined)
                      }
                      external={row.sourceTxHash !== currentHash}
                      externalLabel={`View source transaction on ${L1_EXPLORER_NAME ?? "the Cardano explorer"}`}
                      head={10}
                      tail={8}
                    />
                  </div>
                  <AdaAmount lovelace={row.lovelace} />
                </div>
                {row.address ? (
                  <div className="mt-3 min-w-0">
                    <p className="mg-overline">Address</p>
                    <Identifier value={row.address} head={14} tail={10} />
                    {knownValidator ? (
                      <p className="mt-1 mg-caption text-text-2">
                        <ValidatorLabel family={knownValidator.family} validators={validators} />
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {row.paymentCred ? (
                    <Detail
                      label="Payment credential"
                      semantic="paymentCredential"
                      value={<Identifier value={row.paymentCred} head={10} tail={8} />}
                    />
                  ) : null}
                  {row.stakeAddr ? (
                    <Detail
                      label="Stake credential"
                      semantic="stakeCredential"
                      value={<Identifier value={row.stakeAddr} head={12} tail={8} />}
                    />
                  ) : null}
                  {row.datumHash ? (
                    <Detail
                      label="Datum hash"
                      semantic="datumHash"
                      value={<Identifier value={row.datumHash} head={10} tail={8} />}
                    />
                  ) : null}
                  {row.refScriptHash ? (
                    <Detail
                      label="Reference script"
                      semantic="script"
                      value={<Identifier value={row.refScriptHash} head={10} tail={8} />}
                    />
                  ) : null}
                </dl>
                {row.assets.length > 0 ? <Assets rows={row.assets} /> : null}
                {row.inlineDatum !== null ? (
                  <div className="mt-3">
                    <JsonPanel
                      title="Inline datum"
                      term="inlineDatum"
                      semantic="datum"
                      value={row.inlineDatum}
                    />
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Assets({ rows }: { rows: readonly L1TxIo["assets"][number][] }) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mg-overline">
        <FieldLabel label="Native assets" term="assetFingerprint" />
      </p>
      <ul className="mt-2 space-y-2">
        {rows.map((asset) => (
          <li
            key={`${asset.policyId}.${asset.assetName}`}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-2">
              <AssetMark policyId={asset.policyId} nameHex={asset.assetName} />
              <span className="min-w-0">
                <AssetName nameHex={asset.assetName} />
                <span className="block font-mono mg-micro text-text-3">
                  {asset.fingerprint ?? truncateId(asset.policyId, 10, 8)}
                </span>
              </span>
            </span>
            <AssetQuantity quantity={asset.quantity} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Redeemers({
  rows,
  validators,
}: {
  rows: readonly L1Redeemer[];
  validators: readonly L1ValidatorIdentity[];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No Plutus executions"
        hint="This transaction did not execute a redeemer indexed by Midgard."
      />
    );
  }
  return (
    <ol className="space-y-3">
      {rows.map((row, index) => {
        const knownValidator = validatorFor(validators, { scriptHash: row.scriptHash });
        return (
          <li key={`${row.scriptHash}-${row.purpose}-${index}`}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="mg-overline">
                    <SemanticLabel kind="script" label="Script hash" />
                  </p>
                  <Identifier value={row.scriptHash} head={12} tail={8} />
                  {knownValidator ? (
                    <p className="mt-1 mg-caption text-text-2">
                      <ValidatorLabel family={knownValidator.family} validators={validators} />
                    </p>
                  ) : null}
                </div>
                <span
                  className={
                    row.validContract
                      ? "rounded border border-success/35 bg-success/10 px-2 py-1 text-xs font-medium text-success"
                      : "rounded border border-danger/35 bg-danger/10 px-2 py-1 text-xs font-medium text-danger"
                  }
                >
                  {row.validContract ? "Validated" : "Failed"}
                </span>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Purpose" value={row.purpose} />
                <Detail
                  label="Memory units"
                  term="executionUnits"
                  value={formatQuantity(row.memUnits)}
                />
                <Detail
                  label="Step units"
                  term="executionUnits"
                  value={formatQuantity(row.stepUnits)}
                />
                <Detail label="Execution fee" value={<AdaAmount lovelace={row.fee} />} />
                <Detail
                  label="Script size"
                  term="scriptSize"
                  value={row.scriptSize === null ? "Not indexed" : `${row.scriptSize} bytes`}
                />
                {row.datumHash ? (
                  <Detail
                    label="Datum hash"
                    term="datumHash"
                    semantic="datumHash"
                    value={<Identifier value={row.datumHash} head={10} tail={8} />}
                  />
                ) : null}
                {row.address ? (
                  <Detail
                    label="Contract address"
                    value={<Identifier value={row.address} head={12} tail={8} />}
                  />
                ) : null}
              </dl>
              {row.datum !== null ? (
                <div className="mt-3">
                  <JsonPanel
                    title="Redeemer data"
                    term="redeemer"
                    semantic="script"
                    value={row.datum}
                  />
                </div>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

export function MintRows({ tx }: { tx: L1TransactionResponse }) {
  if (tx.mints.length === 0) {
    return (
      <EmptyState
        title="No mint or burn"
        hint="This transaction did not change a native asset supply."
      />
    );
  }
  return (
    <Card className="divide-y divide-border">
      <div className="p-4">
        <h2 className="text-[15px] font-semibold text-text">
          <SemanticLabel kind="mintBurn" label="Native asset supply changes" />
        </h2>
      </div>
      {tx.mints.map((asset) => {
        const burn = asset.quantity.startsWith("-");
        return (
          <div
            key={`${asset.policyId}.${asset.assetName}`}
            className="flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <span className="flex min-w-0 items-center gap-2">
              <AssetMark policyId={asset.policyId} nameHex={asset.assetName} size={24} />
              <span>
                <AssetName nameHex={asset.assetName} />
                <span className="block font-mono mg-micro text-text-3">
                  {asset.fingerprint ?? truncateId(asset.policyId, 12, 8)}
                </span>
              </span>
            </span>
            <span className={burn ? "text-danger" : "text-success"}>
              <span className="mr-2 text-xs font-medium">{burn ? "Burn" : "Mint"}</span>
              <AssetQuantity quantity={asset.quantity} />
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export function Events({
  rows,
  validators,
}: {
  rows: readonly L1Event[];
  validators: readonly L1ValidatorIdentity[];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No Midgard protocol events"
        hint="None of this transaction's outputs were classified as a Midgard validator event."
      />
    );
  }
  return (
    <ol className="space-y-3">
      {rows.map((row, index) => (
        <li key={`${row.validator}-${row.outputIndex}-${index}`}>
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="mg-overline">
                  <SemanticLabel kind="protocolEvent" label="Protocol event" />
                </p>
                <h2 className="mt-0.5 text-[15px] font-semibold text-text">{row.eventType}</h2>
                <p className="mg-caption text-text-3">
                  <ValidatorLabel family={row.validator} validators={validators} /> validator,
                  output #{row.outputIndex}
                </p>
              </div>
              <AdaAmount lovelace={row.lovelace} />
            </div>
            <p className="mt-2 mg-caption text-text-3">Deployment: {row.deployment}</p>
            {row.decoded !== null ? (
              <div className="mt-3">
                <JsonPanel
                  title="Decoded event"
                  term="protocolEvent"
                  semantic="protocolEvent"
                  value={row.decoded}
                />
              </div>
            ) : row.datum !== null ? (
              <div className="mt-3">
                <JsonPanel
                  title="Raw datum"
                  term="inlineDatum"
                  semantic="datum"
                  value={row.datum}
                />
              </div>
            ) : null}
          </Card>
        </li>
      ))}
    </ol>
  );
}

export function validityInterval(before: string | null, after: string | null): string {
  if (before !== null && after !== null) return `Slots ${before} to ${after}`;
  if (before !== null) return `From slot ${before}`;
  if (after !== null) return `Until slot ${after}`;
  return "Unbounded";
}
