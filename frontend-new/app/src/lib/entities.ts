import type { IconName } from "../components/ui/icons";

/**
 * What each record type is called, which glyph stands for it, and what hue it
 * takes.
 *
 * One registry rather than a choice per page: a type that is a cube in the
 * search results and a square in a table teaches a reader nothing, and the
 * whole value of a type mark is that it becomes recognisable.
 *
 * Three channels, always together: the glyph, the word, and the colour. Colour
 * is never the only one, so the marks survive a colour-blind reader, a
 * greyscale print, and a dark room.
 *
 * Type colour is deliberately not drawn from the status palette. Success,
 * warning and danger mean something here, and a withdrawal is not a warning.
 * Only the hue lives in this file; lightness and chroma come from
 * `--mg-type-l` and `--mg-type-c`, which the theme sets, so every type keeps
 * the same weight and contrast in both themes.
 */

export type EntityKind =
  | "transaction"
  | "block"
  | "address"
  | "asset"
  | "policy"
  | "deposit"
  | "withdrawal"
  | "forcedTransaction"
  | "l1Transaction"
  | "validator";

export type Entity = {
  label: string;
  icon: IconName;
  /** Degrees on the colour wheel. Spaced so neighbours are distinguishable. */
  hue: number;
};

export const ENTITIES = {
  transaction: { label: "Transaction", icon: "transfer", hue: 155 },
  block: { label: "Block", icon: "cube", hue: 265 },
  address: { label: "Address", icon: "wallet", hue: 45 },
  asset: { label: "Asset", icon: "coin", hue: 200 },
  policy: { label: "Policy", icon: "key", hue: 320 },
  deposit: { label: "Deposit", icon: "arrowDownToLine", hue: 120 },
  withdrawal: { label: "Withdrawal", icon: "arrowUpFromLine", hue: 20 },
  forcedTransaction: { label: "Forced transaction", icon: "zap", hue: 355 },
  l1Transaction: { label: "Cardano transaction", icon: "layers", hue: 240 },
  validator: { label: "Validator", icon: "shield", hue: 285 },
} as const satisfies Record<EntityKind, Entity>;

/** Neutral, and named as what it is. Record types arrive from the backend and
 * from search classification, both of which are free to grow; an unrecognised
 * one must render as itself rather than break the page it appears on. */
const UNKNOWN: Entity = { label: "Record", icon: "hash", hue: 0 };

export function entityOf(kind: EntityKind): Entity {
  return ENTITIES[kind] ?? UNKNOWN;
}

/** The CSS colour for a type. Lightness and chroma come from the theme, so this
 * is the only place a hue becomes a colour. */
export const entityColor = (hue: number): string =>
  `oklch(var(--mg-type-l) var(--mg-type-c) ${hue})`;
