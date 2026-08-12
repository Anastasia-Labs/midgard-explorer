import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type {
      L1TransactionResponse,
    L1ValidatorIdentity,
} from "../../../../lib/api";
import { ApiExample } from "../../../../components/ui/apiexample";
import { AdaAmount } from "../../../../components/ui/amount";
import { Breadcrumbs } from "../../../../components/ui/breadcrumbs";
import { Icon } from "../../../../components/ui/icons";
import { IdentityBar } from "../../../../components/ui/identitybar";
import { PageError } from "../../../../components/ui/pageerror";
import { Card, PageHeader } from "../../../../components/ui/primitives";
import { RawData } from "../../../../components/ui/rawdata";
import { SummaryBand } from "../../../../components/ui/summary";
import { Tabs } from "../../../../components/ui/tabs";
import { ApiError, api } from "../../../../lib/api";
import { groupThousands, truncateId } from "../../../../lib/format";
import { L1_EXPLORER_NAME, l1TxUrl } from "../../../../lib/network";
import { listErrorMessage } from "../../../../lib/serverErrors";
import { viewerInit } from "../../../../lib/viewerInit";
import {
    Events,
  IoSection,
  MintRows,
  Overview,
  Redeemers,
} from "../../../../features/l1transaction/sections";

export const dynamic = "force-dynamic";

const isTxHash = (value: string) => /^[0-9a-fA-F]{64}$/.test(value);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txHash: string }>;
}): Promise<Metadata> {
  const { txHash } = await params;
  return {
    title: `L1 tx ${truncateId(txHash)}`,
    description: `Cardano L1 transaction ${txHash} touching Midgard.`,
  };
}

const CRUMBS = [
  { label: "Overview", href: "/" },
  { label: "Cardano L1", href: "/l1" },
  { label: "Transaction" },
];

/** A hash this explorer holds no Midgard record for.
 *
 * Answering with the application's not-found page was wrong twice over: the
 * transaction usually does exist on Cardano, and a 404 made the reader
 * discover the internal/external distinction by hitting a dead end. This page
 * says which case it is and hands the question to an explorer that can answer
 * it. */
function NotIndexed({ hash, externalHref }: { hash: string; externalHref: string | null }) {
  return (
    <Card className="p-6 text-center">
      <h2 className="text-[15px] font-semibold text-text">No Midgard record for this transaction</h2>
      <p className="mx-auto mt-2 max-w-prose mg-caption leading-relaxed text-text-2">
        This explorer indexes Cardano transactions that touch a Midgard contract. Nothing here
        references <span className="font-mono">{truncateId(hash, 10, 8)}</span>, so it is either an
        ordinary Cardano transaction or one this deployment has not reached yet.
      </p>
      {externalHref === null ? null : (
        <a
          href={externalHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm font-medium text-text transition-colors hover:border-link hover:text-link"
        >
          View on {L1_EXPLORER_NAME ?? "the Cardano explorer"}
          <Icon name="external" size={14} />
        </a>
      )}
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
        <PageHeader entity="transaction" title="Cardano L1 transaction" />
        <IdentityBar
          overline="Transaction hash"
          value={hash}
          {...(externalHref === null ? {} : { externalHref })}
          externalLabel={`Open transaction on ${L1_EXPLORER_NAME ?? "the Cardano explorer"}`}
        />
        {unindexed ? (
          <NotIndexed hash={hash} externalHref={externalHref} />
        ) : (
          <PageError message={listErrorMessage(error)} />
        )}
      </>
    );
  }

  let validators: readonly L1ValidatorIdentity[] = [];
  try {
    validators = (await api.l1Summary(init)).source?.validators ?? [];
  } catch {
    // The transaction remains usable; unknown contracts simply stay unlabeled.
  }

  const allCollateral = tx.collateralOutput
    ? [...tx.collateral, tx.collateralOutput]
    : tx.collateral;
  const externalHref = l1TxUrl(tx.txHash);

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="transaction"
        title="Cardano L1 transaction"
        subtitle="The Cardano transaction that touched one or more Midgard contracts."
      />
      <IdentityBar
        overline="Transaction hash"
        value={tx.txHash}
        {...(externalHref === null ? {} : { externalHref })}
        externalLabel={`Open transaction on ${L1_EXPLORER_NAME ?? "the Cardano explorer"}`}
      />

      <SummaryBand
        items={[
          {
            label: "Block",
            term: "blockHeight",
            value: <span className="font-mono">#{tx.blockHeight}</span>,
          },
          { label: "Fee", term: "fee", value: <AdaAmount lovelace={tx.fee} /> },
          {
            label: "Total output",
            term: "totalOutput",
            value: <AdaAmount lovelace={tx.totalOutput} />,
          },
          {
            label: "Size",
            value: (
              <span className="font-mono tabular-nums">
                {groupThousands(String(tx.size))}
                <span className="ml-1 text-text-3">bytes</span>
              </span>
            ),
          },
        ]}
      />

      <Tabs
        label="Cardano transaction sections"
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: <Overview tx={tx} />,
          },
          {
            id: "utxos",
            label: "UTxOs",
            count: tx.inputs.length + tx.outputs.length + tx.referenceInputs.length,
            content: (
              <div className="space-y-4">
                <IoSection
                  title="Inputs"
                  kind="input"
                  explanation="UTxOs consumed by this transaction."
                  rows={tx.inputs}
                  currentHash={tx.txHash}
                  validators={validators}
                />
                <IoSection
                  title="Reference inputs"
                  kind="referenceInput"
                  explanation="UTxOs read by scripts without being consumed."
                  rows={tx.referenceInputs}
                  currentHash={tx.txHash}
                  validators={validators}
                />
                <IoSection
                  title="Outputs"
                  kind="output"
                  explanation="New UTxOs created by this transaction."
                  rows={tx.outputs}
                  currentHash={tx.txHash}
                  validators={validators}
                />
              </div>
            ),
          },
          {
            id: "contracts",
            label: "Contracts",
            count: tx.redeemers.length,
            content: <Redeemers rows={tx.redeemers} validators={validators} />,
          },
          {
            id: "collateral",
            label: "Collateral",
            count: allCollateral.length,
            content: (
              <div className="space-y-4">
                <IoSection
                  title="Collateral inputs"
                  kind="collateral"
                  explanation="Inputs reserved to cover script-validation costs if execution fails."
                  rows={tx.collateral}
                  currentHash={tx.txHash}
                  validators={validators}
                />
                <IoSection
                  title="Collateral return"
                  kind="collateral"
                  explanation="Collateral change returned when the transaction declares one."
                  rows={tx.collateralOutput ? [tx.collateralOutput] : []}
                  currentHash={tx.txHash}
                  validators={validators}
                />
              </div>
            ),
          },
          {
            id: "mint",
            label: "Mint / burn",
            count: tx.mints.length,
            content: <MintRows tx={tx} />,
          },
          {
            id: "events",
            label: "Events",
            count: tx.events.length,
            content: <Events rows={tx.events} validators={validators} />,
          },
          {
            id: "raw",
            label: "Raw",
            content: (
              <div className="space-y-4">
                <ApiExample path={`/api/l1/transaction?txHash=${tx.txHash}`} />
                <RawData data={tx} filename={`l1-tx-${tx.txHash}.json`} />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
