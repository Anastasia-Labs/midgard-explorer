import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "../../../../components/ui/breadcrumbs";
import { PageError } from "../../../../components/ui/pageerror";
import { PageHeader } from "../../../../components/ui/primitives";
import { api } from "../../../../lib/api";
import { ApiError } from "../../../../lib/api";
import { listErrorMessage } from "../../../../lib/serverErrors";

export const metadata: Metadata = {
  title: "Block by height",
  description: "Resolve a Midgard L2 block height to its header hash.",
};

export const dynamic = "force-dynamic";

/** Height is a search alias, not a second identity for a block: it resolves to
 * the canonical header-hash URL so links and history stay on one address. */
export default async function BlockByHeightPage({
  params,
}: {
  params: Promise<{ height: string }>;
}) {
  const raw = (await params).height;
  const height = Number(raw);
  const valid = Number.isSafeInteger(height) && height >= 0;

  let headerHash: string | null = null;
  let failure: string | null = null;
  if (valid) {
    try {
      headerHash = (await api.blockByHeight(height)).header_hash;
    } catch (e) {
      failure =
        e instanceof ApiError && e.category === "http_404"
          ? `No block at height ${height}.`
          : listErrorMessage(e);
    }
  }

  if (headerHash !== null) redirect(`/block/${headerHash}`);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/" },
          { label: "Blocks", href: "/blocks" },
        ]}
      />
      <PageHeader title="Block not found" />
      <PageError
        message={
          valid ? (failure ?? `No block at height ${height}.`) : `"${raw}" is not a block height.`
        }
      />
    </>
  );
}
