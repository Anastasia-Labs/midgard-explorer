import type { CSSProperties } from "react";
import { entityColor, entityOf, type EntityKind } from "../../../lib/entities";
import { Icon } from "../base/icons";
import { cn } from "../../../lib/format";

/**
 * The glyph alone, for places where the word is already on screen beside it.
 *
 * Still two channels, since the glyph itself discriminates. `aria-hidden` comes
 * from `Icon`, which is correct here: the word this stands next to is the
 * accessible one.
 */
export function EntityIcon({
  kind,
  size = 16,
  className,
}: {
  kind: EntityKind;
  size?: number;
  className?: string | undefined;
}) {
  const entity = entityOf(kind);
  return (
    <span
      className={cn("inline-flex", className)}
      style={{ color: entityColor(entity.hue) } as CSSProperties}
    >
      <Icon name={entity.icon} size={size} />
    </span>
  );
}
