/**
 * Rewrites BigInt values as strings so a response can be serialized.
 *
 * `JSON.stringify` throws on a BigInt, and Postgres hands back BigInt for every
 * lovelace amount and execution unit, so this sits in front of `res.json`.
 *
 * Two things changed here. It took `any`, which is the widest possible input
 * type on the one function every response passes through: a caller could hand
 * it anything and no shape was ever checked. And it rewrote its argument in
 * place, so the object a route built, and the object the response cache may be
 * holding, were edited by the act of sending them. It now returns a new value
 * and leaves the input alone.
 *
 * `Date` is passed through untouched: it has its own `toJSON`, and recursing
 * into it would produce an empty object.
 */
export const bigintStringify = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();

  if (value === null || typeof value !== "object") return value;

  if (value instanceof Date) return value;

  if (Array.isArray(value)) return value.map(bigintStringify);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = bigintStringify(item);
  }
  return out;
};
