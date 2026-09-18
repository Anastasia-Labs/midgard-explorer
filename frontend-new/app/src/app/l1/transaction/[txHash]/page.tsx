import type { Metadata } from "next";
import { isHash32 } from "@midgard-explorer/contracts";
import { notFound } from "next/navigation";
import type { CardanoActivityRow, CardanoReferenceResponse } from "@midgard-explorer/contracts";
import { Breadcrumbs } from "../../../../components/ui/base/breadcrumbs";
import { IdentityBar } from "../../../../components/ui/domain/identitybar";
import { PageError } from "../../../../components/ui/base/pageerror";
import { Callout, Card, PageHeader } from "../../../../components/ui/base/layout";
import { Identifier } from "../../../../components/ui/domain/identifier";
import { StatusBadge } from "../../../../components/ui/domain/status";
import { Timestamp } from "../../../../components/ui/base/timestamp";
import { api } from "../../../../lib/api";
import { truncateId } from "../../../../lib/format";
import { L1_EXPLORER_NAME, l1TxUrl } from "../../../../lib/network";
import { listErrorMessage } from "../../../../lib/serverErrors";
import { viewerInit } from "../../../../lib/viewerInit";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txHash: string }>;
}): Promise<Metadata> {
  const { txHash } = await params;
  return {
    title: `Cardano tx ${truncateId(txHash)}`,
    description: `What Midgard records about Cardano transaction ${txHash}.`,
  };
}

const CRUMBS = [
  { label: "Overview", href: "/" },
  { label: "Cardano", href: "/l1" },
  { label: "Transaction" },
];

const KIND_LABEL: Record<CardanoActivityRow["kind"], string> = {
  settlement: "Block settlement",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  forced_transaction: "Forced transaction",
};

const KIND_DETAIL: Record<CardanoActivityRow["kind"], string> = {
  settlement: "The node submitted this transaction to commit a Midgard block to Cardano.",
  deposit: "The node read a deposit from this transaction.",
  withdrawal: "The node read a withdrawal request from this transaction.",
  forced_transaction: "The node read a forced-transaction order from this transaction.",
};

const recordHref = (row: CardanoActivityRow): string | null => {
  if (row.kind === "settlement") {
    return row.headerHash === null ? null : `/block/${row.headerHash}`;
  }
  if (row.recordId === null) return null;
  const list =
    row.kind === "deposit"
      ? "deposits"
      : row.kind === "withdrawal"
        ? "withdrawals"
        : "forced-transactions";
  return `/${list}?id=${row.recordId}`;
};

function Reference({ row }: { row: CardanoActivityRow }) {
  const href = recordHref(row);
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border p-4">
        <h2 className="text-body font-semibold text-text">{KIND_LABEL[row.kind]}</h2>
        {row.status === null ? null : <StatusBadge status={row.status} />}
      </div>
      <dl className="flex flex-col gap-3 p-4">
        <p className="text-sm text-text-2">{KIND_DETAIL[row.kind]}</p>
        {row.headerHash === null ? null : (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-sm text-text-3">Midgard block</dt>
            <dd className="min-w-0 text-sm">
              <Identifier value={row.headerHash} href={`/block/${row.headerHash}`} />
            </dd>
          </div>
        )}
        {row.recordId === null ? null : (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-sm text-text-3">Record</dt>
            <dd className="min-w-0 text-sm">
              {href === null ? (
                <Identifier value={row.recordId} />
              ) : (
                <Identifier value={row.recordId} href={href} />
              )}
            </dd>
          </div>
        )}
        {row.outputIndex === null ? null : (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-sm text-text-3">Output</dt>
            <dd className="min-w-0 font-mono text-sm">#{row.outputIndex}</dd>
          </div>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-sm text-text-3">Recorded by the node</dt>
          <dd className="min-w-0 text-sm">
            <Timestamp iso={row.recordedAt} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/**
 * What Midgard records about one Cardano transaction.
 *
 * Deliberately thin. This page used to render the transaction itself, decoded
 * from the explorer's own chain index: its inputs and outputs, its script
 * executions, its datums. The index is decommissioned, so what is left is the
 * question this explorer can still answer better than a Cardano explorer can,
 * which is why Midgard cares about the hash at all.
 *
 * Everything else about the transaction is a question for a Cardano explorer,
 * and the link out is on the identity bar rather than buried, because for a
 * reader who arrived wanting the inputs and outputs it is the whole answer.
 */
export default async function L1TransactionPage({
  params,
}: {
  params: Promise<{ txHash: string }>;
}) {
  const { txHash } = await params;
  if (!isHash32(txHash)) notFound();
  const hash = txHash.toLowerCase();
  const externalHref = l1TxUrl(hash);
  const externalName = L1_EXPLORER_NAME ?? "the Cardano explorer";

  let data: CardanoReferenceResponse;
  try {
    data = await api.cardanoReferences(hash, await viewerInit());
  } catch (error) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="transaction" title="Cardano transaction" />
        <IdentityBar
          overline="Transaction hash"
          value={hash}
          {...(externalHref === null ? {} : { externalHref })}
          externalLabel={`View on ${externalName}`}
        />
        <PageError message={listErrorMessage(error)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader entity="transaction" title="Cardano transaction" />
      <IdentityBar
        overline="Transaction hash"
        value={hash}
        {...(externalHref === null ? {} : { externalHref })}
        externalLabel={`View on ${externalName}`}
      />

      {data.references.length === 0 ? (
        <Card className="p-6 text-center">
          <h2 className="text-body font-semibold text-text">
            Midgard has no record of this transaction
          </h2>
          <p className="mx-auto mt-2 max-w-prose mg-caption leading-relaxed text-text-2">
            No block settlement, deposit, withdrawal or forced-transaction order in this deployment
            names <span className="font-mono">{truncateId(hash, 10, 8)}</span>. That is a fact about
            Midgard&apos;s records, not about Cardano: this explorer does not read the chain
            {externalHref === null ? "" : `, so check ${externalName} for the transaction itself`}.
          </p>
        </Card>
      ) : (
        <>
          {data.references.map((row) => (
            <Reference key={`${row.kind}-${row.recordId ?? row.headerHash ?? "one"}`} row={row} />
          ))}
          <Callout tone="neutral" title="What this page does not show.">
            The transaction&apos;s own contents: its inputs, outputs, scripts and datums. Those live
            on Cardano and this explorer does not read it
            {externalHref === null ? "." : `, so ${externalName} is where to read them.`}
          </Callout>
        </>
      )}
    </>
  );
}
