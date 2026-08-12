import type { Metadata } from "next";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { PageHeader } from "../../components/ui/primitives";
import { GLOSSARY } from "../../lib/glossary";

export const metadata: Metadata = {
  title: "Glossary",
  description: "Midgard and Cardano explorer terminology.",
};

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Glossary" }];
const CATEGORIES = ["Ledger", "Transaction", "Script", "Asset", "Explorer"] as const;

export default function GlossaryPage() {
  const entries = Object.values(GLOSSARY);
  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Glossary"
        subtitle="Definitions used consistently across Midgard and Cardano transaction views."
      />
      <div className="divide-y divide-border border-y border-border">
        {CATEGORIES.map((category) => (
          <section
            key={category}
            aria-labelledby={`glossary-${category.toLowerCase()}`}
            className="grid gap-3 py-6 lg:grid-cols-[12rem_1fr]"
          >
            <h2
              id={`glossary-${category.toLowerCase()}`}
              className="font-display text-xl font-semibold text-page-title"
            >
              {category}
            </h2>
            <dl className="divide-y divide-border">
              {entries
                .filter((entry) => entry.category === category)
                .map((entry) => (
                  <div
                    key={entry.label}
                    className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-5"
                  >
                    <dt className="text-sm font-semibold text-text">{entry.label}</dt>
                    <dd className="text-sm leading-relaxed text-text-2">
                      {entry.meaning} {entry.consequence}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}
