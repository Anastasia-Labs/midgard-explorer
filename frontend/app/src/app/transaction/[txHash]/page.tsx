import type { Metadata } from "next";
import { isHash32 } from "@midgard-explorer/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LifecyclePoller } from "../../../features/transaction/LifecyclePoller";
import { ApiExample } from "../../../components/ui/domain/apiexample";
import { AdaAmount, ValueCell } from "../../../components/ui/domain/amount";
import { Breadcrumbs } from "../../../components/ui/base/breadcrumbs";
import { IdentityBar } from "../../../components/ui/domain/identitybar";
import { PageError } from "../../../components/ui/base/pageerror";
import { Callout } from "../../../components/ui/base/layout";
import { RawData } from "../../../components/ui/base/rawdata";
import { DatumPanel, RawCbor, WitnessPanel } from "../../../components/ui/domain/scriptdata";
import { Journey } from "../../../components/ui/domain/journey";
import {
  CardanoAssociation,
  hasRecordedSettlement,
} from "../../../components/ui/domain/association";
import { StatusBadge, ToneBadge } from "../../../components/ui/domain/status";
import { Tabs } from "../../../components/ui/base/tabs";
import { Timestamp } from "../../../components/ui/base/timestamp";
import { TransactionEvents } from "../../../components/ui/domain/transactionevents";
import { api } from "../../../lib/api";
import { transactionForDisplay } from "../../../lib/transactionDisplay";
import { OUTCOME_TONE, transactionJourney } from "../../../lib/journey";
import { truncateId } from "../../../lib/format";
import { TERMINAL_TX_STATUSES } from "../../../lib/txStatus";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";
import { statusOf } from "../../../lib/status-registry";
import { viewerInit } from "../../../lib/viewerInit";
import { DetailsTab, ReferenceInputs } from "../../../features/transaction/tabs/OverviewTab";
import { SettlementDetails } from "../../../components/ui/domain/settlementdetails";
import { L1TxLink } from "../../../components/ui/domain/l1link";
import { MintPanel } from "../../../features/transaction/MintPanel";
import { StateTab } from "../../../features/transaction/tabs/StateTab";
import { totalOutputValue } from "../../../features/transaction/ActionSummary";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txHash: string }>;
}): Promise<Metadata> {
  const { txHash } = await params;
  return {
    title: `Tx ${truncateId(txHash)}`,
    description: `Midgard transaction ${txHash}.`,
  };
}

const CRUMBS = [
  { label: "Overview", href: "/" },
  { label: "Transactions", href: "/transactions" },
  { label: "Transaction" },
];

export default async function TransactionPage({ params }: { params: Promise<{ txHash: string }> }) {
  const { txHash } = await params;
  if (!isHash32(txHash)) notFound();
  const hash = txHash.toLowerCase();

  let data;
  try {
    data = await orNotFound(api.transaction(hash, await viewerInit()));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <IdentityBar title="Midgard transaction" overline="Transaction hash" value={hash} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  const status = data.status;
  const terminal = TERMINAL_TX_STATUSES.has(status);
  const journeyModel = transactionJourney({
    status,
    admission: data.admission,
    inclusion: data.inclusion,
    finalization: data.finalization,
  });
  /* One lifecycle answer, resolved once.
   *
   * The page used to state three: the node's raw code in the header badge, the
   * ledger's validity verdict beside the hash, and the journey's headline. On a
   * settled transaction the first read "Committed" while the third read "Final
   * on Cardano", and the registry defines committed as reversible until final,
   * so the badge contradicted the stepper directly beneath it. The journey
   * model is the one that resolves the code together with inclusion and Cardano
   * finality, so it is the one that speaks. */
  const lifecycle = (
    <ToneBadge
      tone={OUTCOME_TONE[journeyModel.outcome]}
      label={journeyModel.headline}
      explain={journeyModel.explanation || undefined}
    />
  );
  const journey = (
    <>
      <Journey model={journeyModel} showHeadline={false}>
        {data.admission ? (
          <p className="font-mono mg-micro text-text-3">
            Node admission record · {data.admission.attemptCount} validation attempt
            {data.admission.attemptCount === 1 ? "" : "s"} · {data.admission.requestCount} request
            {data.admission.requestCount === 1 ? "" : "s"} · source: {data.admission.submitSource}
          </p>
        ) : null}
      </Journey>
    </>
  );

  if (data.transaction === null) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        {/* The same one lifecycle answer this page states when the body decodes.
            A body that could not be decoded changes what can be shown below, not
            where the transaction is in its life. */}
        <IdentityBar
          title="Midgard transaction"
          overline="Transaction hash"
          value={hash}
          badges={lifecycle}
        />
        {journey}
        <CardanoAssociation association={data.cardano} context={data.midgard} />
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
              <p className="mt-1.5">
                At: <Timestamp exact iso={data.rejection.rejectedAt} />
              </p>
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
      <IdentityBar
        title="Midgard transaction"
        overline="Transaction hash"
        value={tx.txId}
        badges={lifecycle}
        summary={[
          {
            label: "Block",
            value: data.inclusion ? (
              <Link
                href={`/block/${data.inclusion.header_hash}`}
                className="text-link hover:text-link-hover hover:underline"
              >
                {data.inclusion.height === null ? "View header" : `#${data.inclusion.height}`}
              </Link>
            ) : (
              "Pending"
            ),
          },
          // The Cardano transaction the node recorded, beside the block it
          // settles. It is evidence, not the verdict: the badge above says
          // which state the settlement is in.
          ...(hasRecordedSettlement(data.cardano) &&
          "l1TxHash" in data.cardano &&
          data.cardano.l1TxHash !== null
            ? [
                {
                  label: "Settlement",
                  value: (
                    <L1TxLink
                      hash={data.cardano.l1TxHash}
                      destination="midgard"
                      marker={false}
                      head={6}
                      tail={6}
                    />
                  ),
                },
              ]
            : []),
          { label: "Time", value: <Timestamp stacked iso={tx.timestamp} /> },
          { label: "Total output", value: <ValueCell value={totalOutputValue(tx)} /> },
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
      ></IdentityBar>
      {tx.validity === "TxIsValid" ? null : (
        <div className="mb-4">
          <Callout tone="danger" title={statusOf(tx.validity).label}>
            {statusOf(tx.validity).explain}
          </Callout>
        </div>
      )}

      {!terminal ? <LifecyclePoller /> : null}
      {journeyModel.outcome !== "complete" ? journey : null}
      {/* The prominent notice is for a record that needs one. A settled record
          does not, in either deployment shape: reading `matched` alone put a
          full-width panel above every settled transaction the moment the
          second source went away. */}
      {hasRecordedSettlement(data.cardano) ? null : (
        <CardanoAssociation association={data.cardano} context={data.midgard} />
      )}

      <Tabs
        aliases={{ utxo: "summary", datums: "scripts", events: "scripts" }}
        tabs={[
          {
            id: "summary",
            label: "Overview",
            content: (
              <>
                {tx.mint && (tx.mint.assets.length > 0 || tx.mint.policyIds.length > 0) ? (
                  <MintPanel mint={tx.mint} />
                ) : null}
                <StateTab tx={tx} proposed={data.inclusion === null} />
              </>
            ),
          },
          ...(datums.length +
            tx.witnesses.scripts.length +
            tx.witnesses.redeemers.length +
            tx.referenceInputs.length >
          0
            ? [
                {
                  id: "scripts",
                  label: "Scripts",
                  content: (
                    <div className="space-y-5">
                      {tx.witnesses.redeemers.length > 0 ? <TransactionEvents tx={tx} /> : null}
                      <WitnessPanel scripts={tx.witnesses.scripts} redeemers={[]} />
                      <DatumPanel datums={datums} />
                      <ReferenceInputs tx={tx} />
                    </div>
                  ),
                },
              ]
            : []),
          {
            id: "details",
            label: "Details",
            content: (
              <DetailsTab
                tx={tx}
                settlement={
                  <SettlementDetails
                    association={data.cardano}
                    context={data.midgard}
                    journey={journeyModel}
                  />
                }
              />
            ),
          },
          {
            id: "raw",
            label: "Raw",
            content: (
              <div className="space-y-4">
                <ApiExample
                  path={`/api/transaction?tx_hash=${tx.txId}`}
                  note="Returns the full API response, including the explorer's source and settlement records."
                />
                {tx.cborHex === null ? null : (
                  <RawCbor
                    cborHex={tx.cborHex}
                    truncated={tx.cborTruncated}
                    size={tx.size}
                    txId={tx.txId}
                  />
                )}
                <RawData
                  title="Transaction JSON"
                  data={transactionForDisplay({
                    tx,
                    status,
                    inclusion: data.inclusion,
                    cardano: data.cardano,
                  })}
                  filename={`tx-${tx.txId}.json`}
                />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
