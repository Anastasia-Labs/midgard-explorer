import type { Metadata } from "next";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";
import { PageHeader } from "../../components/ui/base/layout";
import { Tools } from "../../features/tools/Tools";

export const metadata: Metadata = {
  title: "Tools",
  description: "Decode CBOR, convert ada and lovelace, and split an asset unit.",
  alternates: { canonical: "/tools" },
};

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Tools" }];

/** Utilities that stand on their own, beside the explorer rather than inside a
 * record page. Every reference explorer ships a few of these; they answer the
 * questions a developer has while holding a payload that is not yet on chain. */
export default function ToolsPage() {
  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Tools"
        subtitle="Decode a CBOR payload, convert between ada and lovelace, and split an asset unit into its policy and name. Everything here runs in your browser."
      />
      <Tools />
    </>
  );
}
