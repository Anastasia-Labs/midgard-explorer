/**
 * Holding new rows rather than inserting them under a reader.
 *
 * Every list on this site polls. Inserting a row at the top of a table pushes
 * whatever someone was reading further down the page mid-sentence, and there is
 * no way for them to get it back except to find it again. Blockscout's answer,
 * which the captures recorded, is to keep the visible rows still and put the
 * news in a row of its own that the reader applies when they are ready. That
 * keeps the list live without moving it.
 */

/** How many of `incoming` were not already shown.
 *
 * Rows that left the window are not counted: a fixed-length list drops its
 * oldest row for every new one, and a reader does not need to be told about the
 * one that fell off the bottom. */
export function newRowCount<T>(
  shown: readonly T[],
  incoming: readonly T[],
  keyOf: (row: T) => string,
): number {
  if (incoming.length === 0) return 0;
  const seen = new Set(shown.map(keyOf));
  return incoming.reduce((n, row) => (seen.has(keyOf(row)) ? n : n + 1), 0);
}
