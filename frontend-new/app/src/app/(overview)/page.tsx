import type { Metadata } from "next";
import { Overview } from "../../features/overview/Overview";
import { getOverviewData } from "../../lib/overview";

export const metadata: Metadata = {
  title: "Overview",
  description: "Latest Midgard L2 blocks and transactions.",
  alternates: { canonical: "/" },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initial = await getOverviewData();
  return <Overview initial={initial} />;
}
