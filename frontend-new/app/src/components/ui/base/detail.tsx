import type { ReactNode } from "react";
import type { GlossaryTerm } from "../../../lib/glossary";
import type { SemanticIconKind } from "../../../lib/semantic-icons";
import { FieldLabel } from "./infotip";
import { SemanticLabel } from "./semantic";

export function Detail({
  label,
  value,
  hint,
  term,
  semantic,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  term?: GlossaryTerm;
  semantic?: SemanticIconKind;
}) {
  return (
    <div className="min-w-0">
      <dt className="mg-overline">
        {semantic ? (
          <SemanticLabel kind={semantic} label={label} />
        ) : (
          <FieldLabel label={label} term={term} />
        )}
      </dt>
      <dd className="mt-0.5 text-sm text-text">
        {value}
        {hint ? <span className="mt-0.5 block mg-micro text-text-3">{hint}</span> : null}
      </dd>
    </div>
  );
}
