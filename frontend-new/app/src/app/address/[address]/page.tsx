import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdaAmount, AssetHierarchy } from "../../../components/ui/amount";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { Identifier } from "../../../components/ui/identifier";
import { IdentityBar } from "../../../components/ui/identitybar";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, Card, PageHeader } from "../../../components/ui/primitives";
import { SummaryBand } from "../../../components/ui/summary";
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
          { label: "Transactions", value: data.history.length },
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
        This view shows only what the address endpoint returns: the current spendable ledger state
        and transactions touching this address.
      </p>

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <h2 className="border-b border-border px-4 py-3 font-display text-[15px] font-semibold">
          History ({data.history.length})
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
              header: "Outputs",
              cell: (r) => r.transaction?.outputs.length ?? "Unknown",
              hideBelow: "sm",
              align: "right",
            },
          ]}
          mobileRow={(r) => ({
            primary: (
              <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={6} />
            ),
            status: r.decodeError ? <DecodeWarn error={r.decodeError} /> : null,
            meta: `${r.transaction?.outputs.length ?? 0} outputs`,
          })}
          rows={data.history}
          keyOf={(r) => r.tx_id}
          emptyTitle="No transactions for this address"
        />
      </section>
    </>
  );
}
