import type { Metadata } from "next";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { PageHeader } from "../../components/ui/primitives";
import { Concepts } from "../../features/glossary/Concepts";
import { GlossaryIndex } from "../../features/glossary/GlossaryIndex";

export const metadata: Metadata = {
  title: "Glossary",
  description: "Midgard and Cardano explorer terminology.",
};

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Glossary" }];

export default function GlossaryPage() {
  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Glossary"
        subtitle="Definitions used consistently across Midgard and Cardano transaction views."
      />
      <Concepts />
      <GlossaryIndex />
    </>
  );
}
