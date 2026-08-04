import type { Metadata } from "next";
import {
  AssetFingerprint,
  AssetName,
  AssetQuantity,
  CoverageNote,
} from "../../components/ui/asset";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Identifier } from "../../components/ui/identifier";
import { PageError } from "../../components/ui/pageerror";
import { PageHeader } from "../../components/ui/primitives";
import { DataTable } from "../../components/ui/table";
import { api } from "../../lib/api";
import { assetUnit } from "../../lib/asset";
import { listErrorMessage } from "../../lib/serverErrors";

export const metadata: Metadata = {
  title: "Native assets",
  description: "Native assets held on the Midgard L2 ledger.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Assets" }];

export default async function AssetsPage() {
  let data;
  try {
    data = await api.assets();
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Native assets" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Native assets"
        subtitle="Every asset carried by a spendable UTxO in the current ledger. Mint and burn history is not tracked here."
        meta={
          <span>
            <strong className="font-semibold text-text tabular-nums">{data.total}</strong> distinct{" "}
            {data.total === 1 ? "asset" : "assets"}
          </span>
        }
      />

      <div className="mb-4">
        <CoverageNote coverage={data.coverage} subject="This roster" />
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Native assets on the ledger, most widely held first"
          columns={[
            {
              header: "Asset",
              cell: (r) => (
                <a
                  href={`/asset/${assetUnit(r.policyId, r.assetName)}`}
                  className="text-accent hover:underline"
                >
                  <AssetName nameHex={r.assetName} />
                </a>
              ),
            },
            {
              header: "Fingerprint",
              cell: (r) => <AssetFingerprint policyId={r.policyId} nameHex={r.assetName} />,
              hideBelow: "md",
            },
            {
              header: "Policy",
              cell: (r) => <Identifier value={r.policyId} head={8} tail={6} />,
              hideBelow: "lg",
            },
            {
              header: "Holders",
              cell: (r) => <span className="tabular-nums">{r.holderCount}</span>,
              align: "right",
              hideBelow: "sm",
            },
            {
              header: "On the ledger",
              cell: (r) => <AssetQuantity quantity={r.ledgerQuantity} />,
              align: "right",
            },
          ]}
          mobileRow={(r) => ({
            primary: (
              <a href={`/asset/${assetUnit(r.policyId, r.assetName)}`} className="text-accent">
                <AssetName nameHex={r.assetName} />
              </a>
            ),
            // The fingerprint is what distinguishes two assets sharing a name,
            // so it stays reachable on a phone rather than being dropped with
            // the column it lives in on desktop.
            meta: <AssetFingerprint policyId={r.policyId} nameHex={r.assetName} />,
            secondary: <AssetQuantity quantity={r.ledgerQuantity} />,
            details: [
              { label: "Policy", value: r.policyId },
              { label: "Holders", value: String(r.holderCount) },
              { label: "UTxOs", value: String(r.utxoCount) },
            ],
          })}
          rows={[...data.rows]}
          keyOf={(r) => assetUnit(r.policyId, r.assetName)}
          emptyTitle="No native assets on the ledger"
          emptyHint="Assets appear once a UTxO on the ledger carries one."
        />
      </section>

      {/* A short roster used to stop mid-page and leave the rest empty. The
          page now ends on the thing a reader most needs to know before
          comparing two assets, which is worth a screen whether the list is
          five rows or five hundred. */}
      <section className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-3 font-display text-[15px] font-semibold text-text">
          Reading an asset
        </h2>
        <dl className="grid gap-px bg-border sm:grid-cols-3">
          {(
            [
              [
                "Name",
                "Bytes chosen by whoever minted the asset. Shown as text only when it decodes cleanly and re-encodes to exactly those bytes; otherwise the hex stands as the name.",
              ],
              [
                "Policy",
                "The minting script's hash. Two assets can share a name and differ only here, which is why a name alone never identifies one.",
              ],
              [
                "Fingerprint",
                "CIP-14: one short, unique identifier over policy and name together. This is the one to compare between tools.",
              ],
            ] as const
          ).map(([term, body]) => (
            <div key={term} className="bg-surface px-4 py-3">
              <dt className="mg-overline">{term}</dt>
              <dd className="mt-1 mg-caption leading-relaxed text-text-2">{body}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
