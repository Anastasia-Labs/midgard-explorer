import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "../../../components/ui/base/breadcrumbs";
import { IdentityBar } from "../../../components/ui/domain/identitybar";
import { PageError } from "../../../components/ui/base/pageerror";
import { PageHeader } from "../../../components/ui/base/layout";
import { AddressView } from "../../../features/address/AddressView";
import { api } from "../../../lib/api";
import { classify } from "../../../lib/classify";
import { parsePage } from "../../../lib/parsePage";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";
import { truncateId } from "../../../lib/format";
import { viewerInit } from "../../../lib/viewerInit";

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
    description: "Midgard address balance and history.",
  };
}

export default async function AddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ page?: string; utxo_cursor?: string }>;
}) {
  const address = decodeURIComponent((await params).address);
  const query = await searchParams;
  const page = parsePage(query.page);
  // Hex only: the cursor reaches the node's query, so it is validated here
  // as well as at the route.
  const utxoCursor =
    typeof query.utxo_cursor === "string" && /^(?:[0-9a-fA-F]{2})+$/.test(query.utxo_cursor)
      ? query.utxo_cursor
      : undefined;
  if (classify(address).kind !== "address") notFound();

  let data;
  try {
    data = await orNotFound(api.address(address, page, await viewerInit(), utxoCursor));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="address" title="Address" />
        <IdentityBar overline="Midgard address" value={address} mark />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return <AddressView address={address} page={page} data={data} utxoCursor={utxoCursor} />;
}
