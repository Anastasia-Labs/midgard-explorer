import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdaAmount, AssetHierarchy } from "../../../components/ui/amount";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { Identifier } from "../../../components/ui/identifier";
import { IdentityBar } from "../../../components/ui/identitybar";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, Card, PageHeader } from "../../../components/ui/primitives";
import { StatusCell } from "../../../components/ui/status";
import { SummaryBand } from "../../../components/ui/summary";
import { Timestamp } from "../../../components/ui/timestamp";
import { DataTable, DecodeWarn } from "../../../components/ui/table";
import { api } from "../../../lib/api";
import { classify } from "../../../lib/classify";
import { assetCount, truncateId } from "../../../lib/format";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Address" }];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  return {
    title: `Address ${truncateId(decodeURIComponent(address))}`,
    description: "Midgard L2 address balance and history.",
  };
}

export default async function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const address = decodeURIComponent((await params).address);
  if (classify(address).kind !== "address") notFound();

  let data;
  try {
    data = await orNotFound(api.address(address));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Address" />
        <IdentityBar overline="L2 address" value={address} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader title="Address" />
      <IdentityBar overline="L2 address" value={address} />

      {data.undecodedOutputs > 0 ? (
        <div className="mb-4">
          <Callout tone="warning" title="Balance is incomplete.">
            {data.undecodedOutputs} UTxO{data.undecodedOutputs === 1 ? "" : "s"} at this address
            could not be decoded (legacy encoding), so the balance below undercounts by their value.
          </Callout>
        </div>
      ) : null}

      <SummaryBand
        items={[
          {
            label: "Spendable balance",
            value: <AdaAmount lovelace={data.balance.lovelace} />,
            emphasis: true,
            ...(data.undecodedOutputs > 0
              ? {
                  sub: `Undercount: ${data.undecodedOutputs} output${
                    data.undecodedOutputs === 1 ? "" : "s"
                  } could not be decoded`,
                }
              : {}),
          },
          { label: "Native assets", value: assetCount(data.balance.assets) },
          { label: "UTxOs", value: data.utxoCount },
          { label: "Transactions", value: data.txCount },
          {
            label: "First activity",
            value: data.firstActivity ? <Timestamp iso={data.firstActivity} /> : "Not recorded",
          },
          {
            label: "Latest activity",
            value: data.latestActivity ? <Timestamp iso={data.latestActivity} /> : "Not recorded",
          },
        ]}
      />

      {Object.keys(data.balance.assets).length > 0 ? (
        <Card className="mb-6">
          <h2 className="mg-overline px-4 pt-4">Native assets held</h2>
          <div className="p-4">
            <AssetHierarchy assets={data.balance.assets} />
          </div>
        </Card>
      ) : null}

      <p className="mb-6 text-xs text-text-3">
        Received is exact: it reads each transaction&apos;s own outputs. Spent is shown only when
        every input of a transaction could be resolved, because a transaction&apos;s inputs leave
        the ledger once it is applied. An unresolved input is reported as unknown, never as zero.
      </p>

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <h2 className="border-b border-border px-4 py-3 font-display text-[15px] font-semibold">
          History ({data.txCount})
        </h2>
        <DataTable
          caption="Transactions involving this address"
          columns={[
            {
              header: "Transaction",
              cell: (r) => (
                <span className="inline-flex items-center gap-2">
                  <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} />
                  <DecodeWarn error={r.decodeError} />
                </span>
              ),
            },
            {
              header: "Status",
              cell: (r) => <StatusCell status={r.status} />,
              hideBelow: "sm",
            },
            {
              header: "Block",
              cell: (r) =>
                r.header_hash === null || r.height === null ? (
                  <span className="text-text-3">Not in a block</span>
                ) : (
                  <Link
                    href={`/block/${r.header_hash}`}
                    className="font-display font-semibold tabular-nums text-accent hover:underline"
                  >
                    #{r.height}
                  </Link>
                ),
              hideBelow: "md",
            },
            {
              header: "Received",
              cell: (r) =>
                r.received === null ? (
                  <span className="text-text-3">Unknown</span>
                ) : (
                  <AdaAmount lovelace={r.received} />
                ),
              align: "right",
            },
            {
              header: "Spent",
              cell: (r) =>
                r.spentComplete && r.spent !== null ? (
                  <AdaAmount lovelace={r.spent} />
                ) : (
                  <span
                    className="text-text-3"
                    title="Some inputs of this transaction are no longer in the ledger, so the amount spent from this address cannot be determined."
                  >
                    Inputs pruned
                  </span>
                ),
              hideBelow: "lg",
              align: "right",
            },
            {
              header: "Time",
              cell: (r) =>
                r.time_stamp_tz ? <Timestamp iso={r.time_stamp_tz} /> : <span>Not recorded</span>,
              hideBelow: "sm",
              align: "right",
            },
          ]}
          mobileRow={(r) => ({
            primary: (
              <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={6} />
            ),
            status: (
              <span className="inline-flex items-center gap-1.5">
                <StatusCell status={r.status} />
                {r.decodeError ? <DecodeWarn error={r.decodeError} /> : null}
              </span>
            ),
            meta: r.time_stamp_tz ? <Timestamp iso={r.time_stamp_tz} /> : "Not recorded",
            secondary:
              r.received === null ? null : (
                <span>
                  Received <AdaAmount lovelace={r.received} />
                </span>
              ),
            details: [
              {
                label: "Spent",
                value:
                  r.spentComplete && r.spent !== null ? (
                    <AdaAmount lovelace={r.spent} />
                  ) : (
                    <span className="text-text-3">Inputs pruned</span>
                  ),
              },
            ],
          })}
          rows={data.history}
          keyOf={(r) => r.tx_id}
          emptyTitle="No transactions for this address"
        />
      </section>
    </>
  );
}
