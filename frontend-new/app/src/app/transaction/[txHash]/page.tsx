import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LifecyclePoller } from "../../../features/transaction/LifecyclePoller";
import { ApiExample } from "../../../components/ui/apiexample";
import { AdaAmount, ValueCell } from "../../../components/ui/amount";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { Detail } from "../../../components/ui/detail";
import { Identifier } from "../../../components/ui/identifier";
import { IdentityBar } from "../../../components/ui/identitybar";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, Card, PageHeader } from "../../../components/ui/primitives";
import { RawData } from "../../../components/ui/rawdata";
import { SemanticLabel } from "../../../components/ui/semantic";
import { DatumPanel, RawCbor, WitnessPanel } from "../../../components/ui/scriptdata";
import { Journey } from "../../../components/ui/journey";
import { StatusBadge } from "../../../components/ui/status";
import { SummaryBand } from "../../../components/ui/summary";
import { Tabs } from "../../../components/ui/tabs";
import { TransactionEvents } from "../../../components/ui/transactionevents";
import { api } from "../../../lib/api";
import { transactionJourney } from "../../../lib/journey";
import { formatTimestamp, truncateId } from "../../../lib/format";
import { TERMINAL_TX_STATUSES } from "../../../lib/queryKeys";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";
import { statusOf } from "../../../lib/status-registry";
import { AddressLink } from "../../../components/ui/address";
import { viewerInit } from "../../../lib/viewerInit";
import { DetailsTab } from "../../../features/transaction/tabs/DetailsTab";
import { StateTab } from "../../../features/transaction/tabs/StateTab";
import { CredentialDetails, validityIntervalText } from "../../../features/transaction/tabs/shared";

export const dynamic = "force-dynamic";

const isTxHash = (s: string) => /^[0-9a-fA-F]{64}$/.test(s);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txHash: string }>;
}): Promise<Metadata> {
  const { txHash } = await params;
  return {
    title: `Tx ${truncateId(txHash)}`,
    description: `Midgard L2 transaction ${txHash}.`,
  };
}

const CRUMBS = [
  { label: "Overview", href: "/" },
  { label: "Transactions", href: "/transactions" },
  { label: "Transaction" },
];

export default async function TransactionPage({ params }: { params: Promise<{ txHash: string }> }) {
  const { txHash } = await params;
  if (!isTxHash(txHash)) notFound();
  const hash = txHash.toLowerCase();

  let data;
  try {
    data = await orNotFound(api.transaction(hash, await viewerInit()));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="transaction" title="Transaction" />
        <IdentityBar overline="Transaction hash" value={hash} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  const status = data.status;
  const terminal = TERMINAL_TX_STATUSES.has(status);
  const journey = (
    <Journey
      model={transactionJourney({
        status,
        admission: data.admission,
        inclusion: data.inclusion,
        finalization: data.finalization,
      })}
    >
      {data.admission ? (
        <p className="font-mono mg-micro text-text-3">
          Node admission record · {data.admission.attemptCount} validation attempt
          {data.admission.attemptCount === 1 ? "" : "s"} · {data.admission.requestCount} request
          {data.admission.requestCount === 1 ? "" : "s"} · source: {data.admission.submitSource}
        </p>
      ) : null}
    </Journey>
  );

  if (data.transaction === null) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="transaction" title="Transaction">
          <StatusBadge status={status} />
        </PageHeader>
        {/* Status is on the page header and in the stepper; a third copy here
            adds no information. */}
        <IdentityBar overline="Transaction hash" value={hash} />
        {journey}
        {data.decodeError ? (
          <Callout tone="warning" title="This transaction's body could not be decoded.">
            <p>
              Everything above comes from the node&apos;s own records and is unaffected. Only the
              transaction body is unavailable.
            </p>
            {data.decodeError.detail ? (
              <p className="mt-1.5 font-mono mg-caption wrap-break-word text-text-2">
                {data.decodeError.detail}
              </p>
            ) : null}
          </Callout>
        ) : null}
        {"rejection" in data && data.rejection ? (
          <Callout tone="danger" title="Rejected by the node">
            {data.rejection.reasonCode ? (
              <p>
                Reason: <StatusBadge status={data.rejection.reasonCode} />
              </p>
            ) : null}
            {data.rejection.reasonDetail ? (
              <p className="mt-1.5 font-mono mg-caption wrap-break-word text-text-2">
                {data.rejection.reasonDetail}
              </p>
            ) : null}
            {/* The timeline's terminal entry already carries the rejection
                time from the admission record. Only fall back to the rejection
                row's own timestamp when there is no timeline to carry it, so
                the page never shows two different rejection times. */}
            {data.rejection.rejectedAt && !data.admission ? (
              <p className="mt-1.5">At: {formatTimestamp(data.rejection.rejectedAt)}</p>
            ) : null}
          </Callout>
        ) : data.decodeError ? null : (
          <Callout tone={statusOf(status).tone} title={statusOf(status).explain}>
            The transaction is known to the node but its bytes are not yet in a block or the
            mempool.
          </Callout>
        )}
        {!terminal ? <LifecyclePoller /> : null}
      </>
    );
  }

  const tx = data.transaction;

  const summaryTab = (
    <>
      <Card className="mb-4">
        <h2 className="mg-overline px-4 pt-4">Technical details</h2>
        <dl className="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Fee" term="fee" value={<AdaAmount lovelace={tx.fee} />} />
          <Detail label="Validity" value={<StatusBadge status={tx.validity} />} />
          <Detail label="Time" value={formatTimestamp(tx.timestamp)} />
          <Detail
            label="Validity interval"
            term="validityInterval"
            value={validityIntervalText(tx.validityInterval)}
            hint="The ledger accepts this transaction only inside this slot range."
          />
          <Detail
            label="Network ID"
            term="networkId"
            value={
              tx.networkId === null
                ? "Not declared"
                : tx.networkId === 0
                  ? "0 (testnet)"
                  : tx.networkId === 1
                    ? "1 (mainnet)"
                    : String(tx.networkId)
            }
          />
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
          <Detail label="Inputs" term="input" value={String(tx.inputs.length)} />
          <Detail label="Outputs" term="output" value={String(tx.outputs.length)} />
        </dl>
      </Card>

      {tx.mint && tx.mint.policyIds.length > 0 ? (
        <Card className="mb-4">
          <h2 className="mg-overline px-4 pt-4">
            <SemanticLabel
              kind="mintBurn"
              label={`Mint / burn policies (${tx.mint.policyIds.length})`}
            />
          </h2>
          <p className="px-4 pt-1 mg-caption text-text-3">
            Policy IDs whose assets this transaction mints or burns. Quantities per asset appear on
            the affected outputs in the UTxO flow.
          </p>
          <ul className="space-y-1 p-4">
            {tx.mint.policyIds.map((p) => (
              <li key={p}>
                <Identifier value={p} />
              </li>
            ))}
          </ul>
        </Card>
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
    </>
  );


  // Datums belong to the outputs that carry them, so the output index travels
  // with each one: "an inline datum" alone does not say which UTxO it locks.
  const datums = tx.outputs.flatMap((output) =>
    output.datum === null
      ? []
      : [{ index: output.index, address: output.address, datum: output.datum }],
  );


  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader entity="transaction" title="Transaction">
        <StatusBadge status={status} />
      </PageHeader>
      <IdentityBar
        overline="Transaction hash"
        value={tx.txId}
        badges={<StatusBadge status={tx.validity} />}
      />

      {journey}
      {!terminal ? <LifecyclePoller /> : null}

      <SummaryBand
        items={[
          { label: "Inputs", term: "input", value: tx.inputs.length },
          { label: "Outputs", term: "output", value: tx.outputs.length },
          { label: "Fee", term: "fee", value: <AdaAmount lovelace={tx.fee} /> },
          {
            label: "Size",
            value: (
              <span className="font-mono tabular-nums">
                {tx.size.toLocaleString("en-US")}
                <span className="ml-1 text-text-3">bytes</span>
              </span>
            ),
          },
        ]}
      />

      <Tabs
        tabs={[
          // Named from what the reference explorers call these sections rather
          // than from our own vocabulary: "State" is what Etherscan, Blockscout
          // and cexplorer all call "what this transaction changed", which is
          // exactly what the ledger equation and per-address movement answer.
          { id: "summary", label: "Overview", content: summaryTab },
          {
            id: "utxo",
            label: "State",
            count: tx.inputs.length + tx.outputs.length,
            content: <StateTab tx={tx} />,
          },
          {
            id: "datums",
            label: "Datums & redeemers",
            count: datums.length + tx.witnesses.scripts.length + tx.witnesses.redeemers.length,
            content: (
              <div className="space-y-5">
                <DatumPanel datums={datums} />
                <WitnessPanel scripts={tx.witnesses.scripts} redeemers={tx.witnesses.redeemers} />
              </div>
            ),
          },
          {
            id: "events",
            label: "Events",
            count: tx.witnesses.redeemers.length,
            content: <TransactionEvents tx={tx} />,
          },
          {
            id: "details",
            label: "Details",
            content: <DetailsTab tx={tx} />,
          },
          {
            id: "raw",
            label: "Raw",
            content: (
              <div className="space-y-4">
                <ApiExample path={`/api/transaction?tx_hash=${tx.txId}`} />
                {tx.cborHex === null ? null : (
                  <RawCbor
                    cborHex={tx.cborHex}
                    truncated={tx.cborTruncated}
                    size={tx.size}
                    txId={tx.txId}
                  />
                )}
                <RawData data={data} filename={`tx-${tx.txId}.json`} />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

