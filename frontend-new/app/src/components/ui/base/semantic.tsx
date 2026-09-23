import type { ReactNode } from "react";
import { SEMANTIC_ICONS, type SemanticIconKind } from "../../../lib/semantic-icons";
import { cn } from "../../../lib/format";
import { Icon } from "./icons";
import { FieldLabel } from "./infotip";

/** One stable glyph-plus-word treatment for protocol concepts.
 *
 * The glyph is decorative because the adjacent word remains the accessible
 * fact. The glossary trigger supplies the explanation and consequence.
 */
export function SemanticLabel({
  kind,
  label,
  className,
  help = true,
}: {
  kind: SemanticIconKind;
  label: string;
  className?: string | undefined;
  help?: boolean;
}) {
  const semantic = SEMANTIC_ICONS[kind];
  return (
    <span data-semantic-icon={kind} className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="text-text-3">
        <Icon name={semantic.icon} size={14} />
      </span>
      {help ? <FieldLabel label={label} term={semantic.term} /> : <span>{label}</span>}
    </span>
  );
}

export function SemanticValue({
  kind,
  children,
  className,
}: {
  kind: SemanticIconKind;
  children: ReactNode;
  className?: string | undefined;
}) {
  const semantic = SEMANTIC_ICONS[kind];
  return (
    <span data-semantic-icon={kind} className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="text-text-3">
        <Icon name={semantic.icon} size={14} />
      </span>
      {children}
    </span>
  );
}
