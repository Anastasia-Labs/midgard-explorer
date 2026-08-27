import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LifecyclePoller } from "../../../features/transaction/LifecyclePoller";
import { ApiExample } from "../../../components/ui/apiexample";
import { AdaAmount, ValueCell } from "../../../components/ui/amount";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { IdentityBar } from "../../../components/ui/identitybar";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, PageHeader } from "../../../components/ui/primitives";
import { RawData } from "../../../components/ui/rawdata";
import { DatumPanel, RawCbor, WitnessPanel } from "../../../components/ui/scriptdata";
import { Journey } from "../../../components/ui/journey";
import { StatusBadge, ToneBadge } from "../../../components/ui/status";
import { Tabs } from "../../../components/ui/tabs";
import { Timestamp } from "../../../components/ui/timestamp";
import { TransactionEvents } from "../../../components/ui/transactionevents";
import { api } from "../../../lib/api";
import { OUTCOME_TONE, transactionJourney } from "../../../lib/journey";
import { formatTimestamp, truncateId } from "../../../lib/format";
import { TERMINAL_TX_STATUSES } from "../../../lib/queryKeys";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";
import { statusOf } from "../../../lib/status-registry";
import { viewerInit } from "../../../lib/viewerInit";
import { OverviewTab } from "../../../features/transaction/tabs/OverviewTab";
import { StateTab } from "../../../features/transaction/tabs/StateTab";
import { ActionSummary, totalOutputValue } from "../../../features/transaction/ActionSummary";

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
  if (!isTxHash(txHash)) notFound();
  const hash = txHash.toLowerCase();

  let data;
  try {
    data = await orNotFound(api.transaction(hash, await viewerInit()));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="transaction" title="Midgard transaction" />
        <IdentityBar overline="Transaction hash" value={hash} />
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
    <Journey model={journeyModel} showHeadline={false}>
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
        <PageHeader entity="transaction" title="Midgard transaction" />
        {/* The same one lifecycle answer this page states when the body decodes.
            A body that could not be decoded changes what can be shown below, not
            where the transaction is in its life. */}
        <IdentityBar overline="Transaction hash" value={hash} badges={lifecycle} />
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
      <PageHeader entity="transaction" title="Midgard transaction" />
      <IdentityBar
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
          { label: "Time", value: <Timestamp exact iso={tx.timestamp} /> },
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
      />

      <ActionSummary tx={tx} />

      {journey}
      {!terminal ? <LifecyclePoller /> : null}

      <Tabs
        tabs={[
          // Named from what the reference explorers call these sections rather
          // than from our own vocabulary: "State" is what Etherscan, Blockscout
          // and cexplorer all call "what this transaction changed", which is
          // exactly what the ledger equation and per-address movement answer.
          { id: "summary", label: "Overview", content: <OverviewTab tx={tx} /> },
          {
            id: "utxo",
            label: "State",
            count: tx.inputs.length + tx.outputs.length,
            content: <StateTab tx={tx} />,
          },
          ...(datums.length + tx.witnesses.scripts.length + tx.witnesses.redeemers.length > 0
            ? [
                {
                  id: "datums",
                  label: "Datums & redeemers",
                  count:
                    datums.length + tx.witnesses.scripts.length + tx.witnesses.redeemers.length,
                  content: (
                    <div className="space-y-5">
                      <DatumPanel datums={datums} />
                      <WitnessPanel
                        scripts={tx.witnesses.scripts}
                        redeemers={tx.witnesses.redeemers}
                      />
                    </div>
                  ),
                },
              ]
            : []),
          ...(tx.witnesses.redeemers.length > 0
            ? [
                {
                  id: "events",
                  label: "Events",
                  count: tx.witnesses.redeemers.length,
                  content: <TransactionEvents tx={tx} />,
                },
              ]
            : []),
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
