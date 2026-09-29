import type { ReactNode } from "react";
import type { GlossaryTerm } from "../../../lib/glossary";
import { FieldLabel } from "./infotip";

/** One label and its value on a line. A Details tab is read as a list of
 * facts, so it is laid out as one. */
export function FactRow({
  label,
  term,
  children,
}: {
  label: string;
  term?: GlossaryTerm;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-sm text-text-3">
        <FieldLabel label={label} term={term} />
      </dt>
      <dd className="min-w-0 text-sm text-text">{children}</dd>
    </div>
  );
}

/** A named group of fact rows inside a Details card. */
export function FactGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-3 first:border-t-0">
      <h2 className="mg-overline pt-1">{title}</h2>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}
