import type { CSSProperties } from "react";
import { entityColor, entityOf, type EntityKind } from "../../lib/entities";
import { Icon } from "./icons";
import { cn } from "../../lib/format";

/**
 * A record type, shown as glyph plus word plus colour.
 *
 * All three together, every time. The glyph is the channel that survives a
 * colour-blind reader, the word is the channel that survives a screen reader,
 * and the colour is what makes a long list scannable. Dropping any one of them
 * is what the captures showed going wrong elsewhere: a filled pill for one type
 * beside bare coloured text for another, which reads as two different kinds of
 * thing rather than as two values of one field.
 */
export function EntityTag({
  kind,
  size = 14,
  className,
}: {
  kind: EntityKind;
  size?: number;
  className?: string | undefined;
}) {
  const entity = entityOf(kind);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-caption font-medium", className)}
      style={{ color: entityColor(entity.hue) } as CSSProperties}
    >
      <Icon name={entity.icon} size={size} />
      {entity.label}
    </span>
  );
}

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
