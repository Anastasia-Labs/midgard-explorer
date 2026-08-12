/**
 * A generated mark derived from an address.
 *
 * Every address on this site is shown truncated, which leaves a reader matching
 * on six characters at each end. A deterministic mark gives them something
 * easier to hold: the same address always produces the same shape and colours,
 * a different one almost always produces different ones, and no registry or
 * network request is involved, so it works for every address that will ever
 * exist.
 *
 * It carries no information. It is not a checksum, it is not a claim about the
 * address, and collisions are possible. Everywhere it appears, the address
 * itself appears too, which is why the component renders it `aria-hidden`.
 */

/** Five cells a side, mirrored: enough shapes to distinguish, few enough to
 * stay legible at 20px. */
export const IDENTICON_GRID = 5;

export type Identicon = {
  cells: boolean[];
  /** Degrees on the colour wheel. Rendering fixes lightness and chroma so every
   * mark holds the same contrast against either theme. */
  hue: number;
  accentHue: number;
};

/**
 * FNV-1a, 32-bit. Chosen because it is short, dependency-free, and spreads
 * well over the long low-entropy strings addresses actually are: bech32 shares
 * a prefix across a whole network, so a hash that only looked at the first few
 * characters would give every address on the site the same mark.
 */
function hash32(seed: string, offset: number): number {
  let h = 0x811c9dc5 ^ offset;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function identiconFor(seed: string): Identicon {
  const shape = hash32(seed, 0);
  const colour = hash32(seed, 0x9e3779b9);

  // Half the grid plus the middle column decides the rest by mirroring.
  const half = Math.ceil(IDENTICON_GRID / 2);
  const bits: boolean[] = [];
  for (let i = 0; i < half * IDENTICON_GRID; i += 1) {
    // Re-hash per cell rather than consuming 32 bits of one word: a 5x5 grid
    // needs 15 decisions, and reusing bits produces visible repetition.
    bits.push((hash32(seed, i * 0x27d4eb2f) & 0x1f) > 0x0d);
  }

  const cells: boolean[] = new Array<boolean>(IDENTICON_GRID * IDENTICON_GRID).fill(false);
  for (let y = 0; y < IDENTICON_GRID; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const on = bits[y * half + x] ?? false;
      cells[y * IDENTICON_GRID + x] = on;
      cells[y * IDENTICON_GRID + (IDENTICON_GRID - 1 - x)] = on;
    }
  }

  // A blank or solid mark carries no identity, so flip the centre cell to break
  // both. It is the least visually disruptive cell to touch.
  const on = cells.filter(Boolean).length;
  if (on === 0 || on === cells.length) {
    const centre = Math.floor(cells.length / 2);
    cells[centre] = on === 0;
  }

  const hue = colour % 360;
  return {
    cells,
    hue,
    // Offset rather than independent, so the two never come out near-identical
    // and the pair still varies between addresses.
    accentHue: (hue + 150 + (shape % 60)) % 360,
  };
}
