import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "../../../components/ui/base/breadcrumbs";
import { IdentityBar } from "../../../components/ui/domain/identitybar";
import { PageError } from "../../../components/ui/base/pageerror";
import { PageHeader } from "../../../components/ui/base/layout";
import { BlockView } from "../../../features/block/BlockView";
import { api } from "../../../lib/api";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";
import { truncateId } from "../../../lib/format";
import { viewerInit } from "../../../lib/viewerInit";

export const dynamic = "force-dynamic";

const isBlockHash = (s: string) => /^[0-9a-fA-F]{56}$/.test(s);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ headerHash: string }>;
}): Promise<Metadata> {
  const { headerHash } = await params;
  return {
    title: `Block ${truncateId(headerHash)}`,
    description: `Midgard block ${headerHash}.`,
  };
}

export default async function BlockPage({ params }: { params: Promise<{ headerHash: string }> }) {
  const { headerHash } = await params;
  if (!isBlockHash(headerHash)) notFound();
  const hash = headerHash.toLowerCase();

  let data;
  const init = await viewerInit();
  try {
    data = await orNotFound(api.block(hash, init));
  } catch (e) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Overview", href: "/" },
            { label: "Blocks", href: "/blocks" },
            { label: "Block" },
          ]}
        />
        <PageHeader entity="block" title="Block" />
        <IdentityBar overline="Block header hash" value={hash} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  // Cardano-observed evidence is independent from the node DB. Its absence
  // must not make an otherwise valid node block fail to render.
  const l1Header = await api.l1BlockHeader(hash, init).catch(() => null);

  return <BlockView hash={hash} data={data} l1Header={l1Header} />;
}
