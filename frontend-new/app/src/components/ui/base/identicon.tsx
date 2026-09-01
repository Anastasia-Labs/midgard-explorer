import { IDENTICON_GRID, identiconFor } from "../../../lib/identicon";
import { cn } from "../../../lib/format";

/**
 * The generated mark for an address.
 *
 * `aria-hidden` on purpose. It aids recognition, it is not a fact: the address
 * it stands for is always rendered beside it, and a screen reader announcing
 * "image" here would add noise without adding meaning.
 *
 * Lightness and chroma are fixed and only the hue varies, so every mark holds
 * roughly the same weight against either theme. A mark that vanished in light
 * mode would be worse than no mark, because a reader would learn to look for
 * something that is sometimes not there.
 */
export function Identicon({
  seed,
  size = 20,
  className,
}: {
  seed: string;
  size?: number;
  className?: string | undefined;
}) {
  const { cells, hue, accentHue } = identiconFor(seed);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox={`0 0 ${IDENTICON_GRID} ${IDENTICON_GRID}`}
      className={cn("shrink-0 rounded-[4px]", className)}
    >
      <rect width={IDENTICON_GRID} height={IDENTICON_GRID} fill={`oklch(0.6 0.13 ${hue})`} />
      {cells.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={i % IDENTICON_GRID}
            y={Math.floor(i / IDENTICON_GRID)}
            width={1}
            height={1}
            fill={`oklch(0.9 0.09 ${accentHue})`}
          />
        ) : null,
      )}
    </svg>
  );
}
