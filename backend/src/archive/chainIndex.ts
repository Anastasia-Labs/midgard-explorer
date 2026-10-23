import { createHash } from "node:crypto";
import { objectKey } from "./keys";
import type { BlockIndexEntry, Indexes, TxIndexEntry } from "./schema";

/** Entries per index page: one page is one bounded read. */
export const INDEX_PAGE_SIZE = 50;

const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);

/**
 * The published block order: newest header end time first, then a
 * descendant before its ancestor, then header hash.
 *
 * There are no heights. Without a header source the explorer cannot say
 * where a block sits in the canonical chain, so position comes only from what
 * the verified headers state: their times and their `prevHeaderHash` links
 * between archived blocks. Two branches stay two branches.
 */
export function orderBlocks(entries: readonly BlockIndexEntry[]): BlockIndexEntry[] {
  const byHash = new Map(entries.map((e) => [e.headerHash, e]));
  const depth = new Map<string, number>();
  const depthOf = (start: string): number => {
    const path: string[] = [];
    let current: string | undefined = start;
    while (current !== undefined && byHash.has(current) && !depth.has(current)) {
      path.push(current);
      current = byHash.get(current)!.prevHeaderHash;
      if (path.includes(current)) break;
    }
    let d = current !== undefined && depth.has(current) ? depth.get(current)! : -1;
    for (const hash of path.reverse()) depth.set(hash, (d += 1));
    return depth.get(start)!;
  };
  const children = new Map<string, string[]>();
  for (const e of entries) {
    if (byHash.has(e.prevHeaderHash)) {
      children.set(e.prevHeaderHash, [...(children.get(e.prevHeaderHash) ?? []), e.headerHash]);
    }
  }
  return entries
    .map((e) => ({ ...e, children: (children.get(e.headerHash) ?? []).sort() }))
    .sort(
      (a, b) =>
        Number(BigInt(b.endTime) - BigInt(a.endTime)) ||
        depthOf(b.headerHash) - depthOf(a.headerHash) ||
        a.headerHash.localeCompare(b.headerHash),
    );
}

const cut = <T>(fingerprint: string, rows: readonly T[], objects: Record<string, Uint8Array>) => {
  const pages: string[] = [];
  for (let i = 0; i < rows.length; i += INDEX_PAGE_SIZE) {
    const bytes = encode(rows.slice(i, i + INDEX_PAGE_SIZE));
    const key = objectKey(fingerprint, createHash("sha256").update(bytes).digest("hex"));
    objects[key] = bytes;
    pages.push(key);
  }
  return { pages, count: rows.length, pageSize: INDEX_PAGE_SIZE };
};

/**
 * Cuts the block and transaction lists into immutable, content-addressed
 * pages. Transactions follow their block's order, then their position in it;
 * a transaction two blocks carry is listed once per block.
 *
 * Every page is rebuilt on each publish, which is linear in the archive.
 */
export function buildIndexes(
  fingerprint: string,
  blocks: readonly BlockIndexEntry[],
  transactions: readonly TxIndexEntry[],
): { objects: Record<string, Uint8Array>; index: Indexes } {
  const objects: Record<string, Uint8Array> = {};
  const ordered = orderBlocks([...new Map(blocks.map((b) => [b.headerHash, b])).values()]);
  const rank = new Map(ordered.map((b, i) => [b.headerHash, i]));
  const txs = [...new Map(transactions.map((t) => [t.observationKey, t])).values()]
    .filter((t) => rank.has(t.headerHash))
    .sort((a, b) => rank.get(a.headerHash)! - rank.get(b.headerHash)! || a.index - b.index);
  const blockPage: Record<string, number> = {};
  ordered.forEach((b, i) => (blockPage[b.headerHash] = Math.floor(i / INDEX_PAGE_SIZE)));
  return {
    objects,
    index: { blocks: cut(fingerprint, ordered, objects), transactions: cut(fingerprint, txs, objects), blockPage },
  };
}
