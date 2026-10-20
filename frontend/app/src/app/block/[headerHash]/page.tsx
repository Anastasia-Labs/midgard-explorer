import type { Metadata } from "next";
import { decodeBlockNotArchived, isHash28, type ArchiveState } from "@midgard-explorer/contracts";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "../../../components/ui/base/breadcrumbs";
import { IdentityBar } from "../../../components/ui/domain/identitybar";
import { PageError } from "../../../components/ui/base/pageerror";
import { BlockView } from "../../../features/block/BlockView";
import { ApiError, api } from "../../../lib/api";
import { Callout } from "../../../components/ui/base/layout";
import { archiveStateCopy } from "../../../lib/evidence";
import { parsePage } from "../../../lib/parsePage";
import { Timestamp } from "../../../components/ui/base/timestamp";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";
import { truncateId } from "../../../lib/format";
import { viewerInit } from "../../../lib/viewerInit";

export const dynamic = "force-dynamic";

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

/** The archive state a 404 carries for a header the archive knows of. */
const notArchived = (e: unknown): ArchiveState | null => {
  if (!(e instanceof ApiError) || e.category !== "http_404") return null;
  try {
    return decodeBlockNotArchived(e.body).archive;
  } catch {
    return null;
  }
};

export default async function BlockPage({
  params,
  searchParams,
}: {
  params: Promise<{ headerHash: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { headerHash } = await params;
  if (!isHash28(headerHash)) notFound();
  const hash = headerHash.toLowerCase();
  const page = parsePage((await searchParams).page);

  let data;
  const init = await viewerInit();
  try {
    data = await api.block(hash, init, page).catch((e: unknown) => {
      const archive = notArchived(e);
      if (archive !== null) return archive;
      return orNotFound(Promise.reject(e));
    });
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
        <IdentityBar title="Block" overline="Block header hash" value={hash} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  if ("state" in data) {
    const copy = archiveStateCopy(data);
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Overview", href: "/" },
            { label: "Blocks", href: "/blocks" },
            { label: "Block" },
          ]}
        />
        <IdentityBar title="Block" overline="Block header hash" value={hash} />
        <Callout tone={copy.tone} title={copy.title}>
          <p>{copy.detail}</p>
          {data.at !== null ? (
            <p className="mt-1.5 mg-caption text-text-3">
              {data.state === "failed" ? "Last attempt" : "Started"} <Timestamp iso={data.at} />
            </p>
          ) : null}
        </Callout>
      </>
    );
  }

  // Cardano-observed evidence is independent from the node DB. Its absence
  // must not make an otherwise valid node block fail to render.

  return <BlockView hash={hash} data={data} />;
}
