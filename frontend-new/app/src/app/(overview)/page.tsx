import type { Metadata } from "next";
import { Overview } from "../../features/overview/Overview";
import { getOverviewData } from "../../lib/overview";
import { viewerInit } from "../../lib/viewerInit";

export const metadata: Metadata = {
  title: "Overview",
  description: "Latest Midgard L2 blocks and transactions.",
  alternates: { canonical: "/" },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initial = await getOverviewData(await viewerInit());
  return <Overview initial={initial} />;
}
