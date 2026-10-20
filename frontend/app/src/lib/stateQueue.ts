import type { QueueBlock, QueueCommit, StateQueueResponse } from "@midgard-explorer/contracts";

/** One position in the drawn queue, left to right (top to bottom on a phone). */
export type QueueSlot =
  | { kind: "confirmed"; key: string; headerHash: string; updatedAt: string }
  | { kind: "block"; key: string; block: QueueBlock; role: "oldest" | "newest" | null }
  | { kind: "gap"; key: string; count: number }
  | { kind: "commit"; key: string; commit: QueueCommit };

/** The queue in linked order: the confirmed header, the waiting headers with
 * any hidden middle as one gap, then this node's commit on its way. Keys are
 * header hashes, so a header keeps its identity as it moves from commit to
 * queue to the removed lane, and the animation can follow it. */
export function queueSlots(q: StateQueueResponse): QueueSlot[] {
  const slots: QueueSlot[] = [];
  if (q.confirmed) {
    slots.push({
      kind: "confirmed",
      // Stable, not the header hash: the confirmed card keeps its place when
      // a merge changes which header it shows.
      key: "confirmed",
      headerHash: q.confirmed.headerHash,
      updatedAt: q.confirmed.updatedAt,
    });
  }
  const blocks = [...q.oldest, ...q.newest];
  const last = blocks.length - 1;
  // A lone waiting block is the next to merge; it is the newest only when
  // there is an older one.
  const role = (i: number) => (i === 0 ? "oldest" : i === last ? "newest" : null);
  q.oldest.forEach((block, i) =>
    slots.push({ kind: "block", key: block.headerHash, block, role: role(i) }),
  );
  if (q.hidden > 0) slots.push({ kind: "gap", key: "gap", count: q.hidden });
  q.newest.forEach((block, i) =>
    slots.push({ kind: "block", key: block.headerHash, block, role: role(q.oldest.length + i) }),
  );
  if (q.committing)
    slots.push({ kind: "commit", key: q.committing.headerHash, commit: q.committing });
  return slots;
}

/** Headers that joined the queue since the last reading: everything after the
 * newest header the last reading already had. A header that only became
 * visible because the window moved is not new. */
export function joinedQueue(prev: StateQueueResponse, next: StateQueueResponse): string[] {
  const seen = new Set([...prev.oldest, ...prev.newest].map((b) => b.headerHash));
  const order = [...next.oldest, ...next.newest].map((b) => b.headerHash);
  let i = order.length - 1;
  while (i >= 0 && !seen.has(order[i]!)) i--;
  if (i < 0 && seen.size > 0 && next.hidden > 0) return [];
  return order.slice(i + 1);
}

/** What a screen reader hears when a reading changes the queue: only the
 * changes, never the whole queue again. */
export function queueAnnouncement(prev: StateQueueResponse, next: StateQueueResponse): string {
  const parts: string[] = [];
  const merged =
    prev.confirmed?.headerHash !== next.confirmed?.headerHash && next.confirmed !== null;
  if (merged) parts.push("Merge recorded");
  const joined = joinedQueue(prev, next).length;
  if (joined > 0)
    parts.push(joined === 1 ? "1 block joined the queue" : `${joined} blocks joined the queue`);
  if (next.committing && next.committing.headerHash !== prev.committing?.headerHash) {
    parts.push("New commit on its way");
  }
  return parts.join(". ");
}
