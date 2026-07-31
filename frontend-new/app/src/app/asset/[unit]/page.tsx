import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  AssetFingerprint,
  AssetName,
  AssetQuantity,
  CoverageNote,
} from "../../../components/ui/asset";
import { ApiExample } from "../../../components/ui/apiexample";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { Identifier } from "../../../components/ui/identifier";
import { IdentityBar } from "../../../components/ui/identitybar";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, Card, EmptyState, PageHeader } from "../../../components/ui/primitives";
import { RawData } from "../../../components/ui/rawdata";
import { SummaryBand } from "../../../components/ui/summary";
import { DataTable } from "../../../components/ui/table";
import { Tabs } from "../../../components/ui/tabs";
import { api } from "../../../lib/api";
import { assetLabel, parseAssetUnit } from "../../../lib/asset";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ unit: string }>;
}): Promise<Metadata> {
  const { unit } = await params;
  const parsed = parseAssetUnit(unit);
  const label = parsed ? assetLabel(parsed.nameHex).label : unit;
  return {
    title: `Asset ${label}`,
    description: `Native asset ${unit} on Midgard L2.`,
  };
}

export default async function AssetPage({ params }: { params: Promise<{ unit: string }> }) {
  const { unit } = await params;
  const parsed = parseAssetUnit(unit);
  if (parsed === null) notFound();
  const { policyId, nameHex } = parsed;

  const crumbs = [
    { label: "Overview", href: "/" },
    { label: "Assets", href: "/assets" },
    { label: "Asset" },
  ];

  let data;
  try {
    data = await orNotFound(api.asset(policyId, nameHex));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={crumbs} />
        <PageHeader title="Asset" />
        <IdentityBar overline="Asset unit" value={unit} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  const { label } = assetLabel(nameHex);

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <PageHeader title={label} subtitle="A native asset on the Midgard L2 ledger." />
      <IdentityBar overline="Asset unit (policy + name)" value={unit} />

      {/* Identity leads, because the first question about an asset is which
          asset this actually is. A display name does not answer it: two assets
          can share one, and the fingerprint is the only unique short form. */}
      <Card className="mb-4">
        <dl className="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2">
          <Field label="Fingerprint (CIP-14)">
            <AssetFingerprint policyId={policyId} nameHex={nameHex} />
          </Field>
          <Field label="Policy">
            <Identifier value={policyId} head={12} tail={8} />
          </Field>
          <Field label="Name">
            <AssetName nameHex={nameHex} />
          </Field>
          <Field label="Name bytes (hex)">
            <span className="font-mono mg-caption break-all">
              {nameHex === "" ? "(empty)" : nameHex}
            </span>
          </Field>
        </dl>
        {assetLabel(nameHex).canonical ? null : (
          <p className="border-t border-border px-4 py-2.5 mg-micro text-text-3">
            The name above was decoded from its bytes and re-encoded to check it round-trips. It is
            what the ledger holds, not a label this explorer assigned, and it is not unique. Compare
            the fingerprint.
          </p>
        )}
      </Card>

      <SummaryBand
        items={[
          {
            label: "On the ledger",
            value: <AssetQuantity quantity={data.ledgerQuantity} />,
            emphasis: true,
            ...(data.coverage.truncated ? { sub: "Lower bound" } : { sub: "Current ledger" }),
          },
          { label: "Holders", value: data.holderCount },
          { label: "UTxOs scanned", value: data.coverage.scanned.toLocaleString() },
        ]}
      />

      <div className="mb-4">
        <CoverageNote coverage={data.coverage} subject="This asset's total" />
      </div>

      <Tabs
        tabs={[
          {
            id: "holders",
            label: "Holders",
            count: data.holderCount,
            content: (
              <Card>
                {data.holders.length === 0 ? (
                  <EmptyState
                    title="No current holder"
                    hint="No spendable UTxO in the ledger carries this asset. It may have been fully spent, or it may never have existed."
                  />
                ) : (
                  <>
                    <DataTable
                      caption="Addresses holding this asset, largest first"
                      columns={[
                        {
                          header: "Address",
                          cell: (r) => (
                            <Identifier value={r.address} href={`/address/${r.address}`} />
                          ),
                        },
                        {
                          header: "UTxOs",
                          cell: (r) => <span className="tabular-nums">{r.utxoCount}</span>,
                          align: "right",
                          hideBelow: "sm",
                        },
                        {
                          header: "Quantity",
                          cell: (r) => <AssetQuantity quantity={r.quantity} />,
                          align: "right",
                        },
                      ]}
                      mobileRow={(r) => ({
                        primary: (
                          <Identifier
                            value={r.address}
                            href={`/address/${r.address}`}
                            head={10}
                            tail={6}
                          />
                        ),
                        secondary: <AssetQuantity quantity={r.quantity} />,
                        details: [{ label: "UTxOs", value: String(r.utxoCount) }],
                      })}
                      rows={[...data.holders]}
                      keyOf={(r) => r.address}
                      emptyTitle="No current holder"
                    />
                    {data.holdersTruncated ? (
                      <div className="border-t border-border p-4">
                        <Callout tone="neutral" title="Showing the 100 largest holders." />
                      </div>
                    ) : null}
                  </>
                )}
              </Card>
            ),
          },
          {
            id: "raw",
            label: "Raw",
            content: (
              <>
                <div className="mb-4">
                  <ApiExample path={`/api/asset?policy_id=${policyId}&asset_name=${nameHex}`} />
                </div>
                <RawData data={data} filename={`asset-${unit}.json`} />
              </>
            ),
          },
        ]}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mg-overline">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{children}</dd>
    </div>
  );
}
