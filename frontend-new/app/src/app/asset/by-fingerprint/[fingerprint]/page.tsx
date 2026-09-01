import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "../../../../components/ui/base/breadcrumbs";
import { PageError } from "../../../../components/ui/base/pageerror";
import { Callout, PageHeader } from "../../../../components/ui/base/layout";
import { api } from "../../../../lib/api";
import { assetFingerprint, assetUnit } from "../../../../lib/asset";
import { listErrorMessage } from "../../../../lib/serverErrors";
import { viewerInit } from "../../../../lib/viewerInit";

export const dynamic = "force-dynamic";

/** Resolves a CIP-14 fingerprint to the asset it names.
 *
 * A fingerprint is a hash, so it cannot be reversed; the only way back is to
 * fingerprint every asset on the ledger and compare. That is cheap here because
 * the roster is already a bounded scan, and it is worth doing because the
 * fingerprint is the identifier people copy between tools. Searching for one
 * and getting nothing would make the identifier we tell readers to compare
 * useless in the one place it matters.
 */
export default async function ByFingerprintPage({
  params,
}: {
  params: Promise<{ fingerprint: string }>;
}) {
  const { fingerprint } = await params;
  const wanted = decodeURIComponent(fingerprint).toLowerCase();
  if (!wanted.startsWith("asset1")) notFound();

  let roster;
  try {
    roster = await api.assets(await viewerInit());
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={[{ label: "Overview", href: "/" }, { label: "Asset" }]} />
        <PageHeader title="Asset" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  const match = roster.rows.find(
    (r) => assetFingerprint(r.policyId, r.assetName)?.toLowerCase() === wanted,
  );
  if (match) redirect(`/asset/${assetUnit(match.policyId, match.assetName)}`);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/" },
          { label: "Assets", href: "/assets" },
          { label: "Asset" },
        ]}
      />
      <PageHeader title="Asset not on the ledger" />
      <Callout tone="neutral" title="No asset on the current ledger has that fingerprint.">
        <p>
          The fingerprint is well formed, so this is not a typo. Either the asset was fully spent
          and no longer sits in any UTxO, or it belongs to a different network.
          {roster.coverage.truncated
            ? ` This search covered ${roster.coverage.scanned.toLocaleString()} of ${roster.coverage.total.toLocaleString()} ledger entries, so it may also exist beyond the part that was scanned.`
            : ""}
        </p>
        <p className="mt-1.5 font-mono mg-caption wrap-break-word text-text-2">{wanted}</p>
      </Callout>
    </>
  );
}
