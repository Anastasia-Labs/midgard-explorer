import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { L1TransactionResponse } from "../../../../lib/api";
import { Breadcrumbs } from "../../../../components/ui/base/breadcrumbs";
import { IdentityBar } from "../../../../components/ui/domain/identitybar";
import { PageError } from "../../../../components/ui/base/pageerror";
import { Card, PageHeader } from "../../../../components/ui/base/layout";
import { SummaryBand } from "../../../../components/ui/domain/summary";
import { Timestamp } from "../../../../components/ui/base/timestamp";
import { ApiError, api } from "../../../../lib/api";
import { truncateId } from "../../../../lib/format";
import { L1_EXPLORER_NAME, l1TxUrl } from "../../../../lib/network";
import { listErrorMessage } from "../../../../lib/serverErrors";
import { viewerInit } from "../../../../lib/viewerInit";
import { MidgardActions } from "../../../../features/l1transaction/sections";
import { L1Utxos } from "../../../../features/l1transaction/utxos";
import { ScriptExecutions } from "../../../../features/l1transaction/executions";

export const dynamic = "force-dynamic";

const isTxHash = (value: string) => /^[0-9a-fA-F]{64}$/.test(value);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txHash: string }>;
}): Promise<Metadata> {
  const { txHash } = await params;
  return {
    title: `Cardano tx ${truncateId(txHash)}`,
    description: `Cardano transaction ${txHash} touching Midgard.`,
  };
}

const CRUMBS = [
  { label: "Overview", href: "/" },
  { label: "Cardano", href: "/l1" },
  { label: "Transaction" },
];

/** A hash this explorer holds no Midgard record for.
 *
 * Answering with the application's not-found page was wrong twice over: the
 * transaction usually does exist on Cardano, and a 404 made the reader
 * discover the internal/external distinction by hitting a dead end. This page
 * says which case it is and hands the question to an explorer that can answer
 * it. */
function NotIndexed({ hash }: { hash: string }) {
  return (
    <Card className="p-6 text-center">
      <h2 className="text-body font-semibold text-text">No Midgard record for this transaction</h2>
      <p className="mx-auto mt-2 max-w-prose mg-caption leading-relaxed text-text-2">
        No indexed Midgard activity references{" "}
        <span className="font-mono">{truncateId(hash, 10, 8)}</span>.
      </p>
    </Card>
  );
}

export default async function L1TransactionPage({
  params,
}: {
  params: Promise<{ txHash: string }>;
}) {
  const { txHash } = await params;
  if (!isTxHash(txHash)) notFound();
  const hash = txHash.toLowerCase();

  const init = await viewerInit();
  let tx: L1TransactionResponse;
  try {
    tx = await api.l1Transaction(hash, init);
  } catch (error) {
    const externalHref = l1TxUrl(hash);
    const unindexed =
      error instanceof ApiError && (error.category === "http_404" || error.category === "http_400");
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="transaction" title="Cardano transaction" />
        <IdentityBar
          overline="Transaction hash"
          value={hash}
          {...(externalHref === null ? {} : { externalHref })}
          externalLabel={`View on ${L1_EXPLORER_NAME ?? "the Cardano explorer"}`}
        />
        {unindexed ? <NotIndexed hash={hash} /> : <PageError message={listErrorMessage(error)} />}
      </>
    );
  }

  const externalHref = l1TxUrl(tx.txHash);

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader entity="transaction" title="Cardano transaction" />
      <IdentityBar
        overline="Transaction hash"
        value={tx.txHash}
        {...(externalHref === null ? {} : { externalHref })}
        externalLabel={`View on ${L1_EXPLORER_NAME ?? "the Cardano explorer"}`}
      />

      <SummaryBand
        items={[
          {
            label: "Status",
            value: <span className="text-success">Included on Cardano</span>,
          },
          {
            label: "Observed",
            value: <Timestamp exact iso={tx.txTime} />,
          },
          {
            label: "Midgard actions",
            value: tx.actions.length,
          },
        ]}
      />
      <MidgardActions tx={tx} />
      <L1Utxos tx={tx} />
      <ScriptExecutions tx={tx} />
    </>
  );
}
