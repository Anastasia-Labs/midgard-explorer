import type { QueueBlock, StateQueueResponse } from "@midgard-explorer/contracts";

/**
 * The "Show me how it works" example: made-up blocks telling the queue's story
 * one step at a time. Nothing here comes from a node, and the page keeps it
 * in its own card marked as an example, apart from the live queue.
 */

/** A made-up header hash: the step's digit, repeated. */
const fake = (n: number) => n.toString(16).padStart(2, "0").repeat(28);
/** Times are relative to when the example opens, so its cards read "3m ago"
 * like the live ones beside it. */
let opened = 0;
const at = (minutesAgo: number) => new Date(opened - minutesAgo * 60_000).toISOString();

const block = (n: number, minutesAgo: number): QueueBlock =>
  ({
    headerHash: fake(n),
    parentHeaderHash: fake(n - 1),
    origin: "own",
    transactions: n % 3 === 0 ? 1 : 2,
    deposits: 0,
    withdrawals: 0,
    forcedTransactions: 0,
    processedAt: at(minutesAgo),
    blockTime: at(minutesAgo + 1),
    commitTxHash: null,
  }) as unknown as QueueBlock;

const queue = (
  confirmed: number,
  queued: number[],
  extra: Partial<Pick<StateQueueResponse, "committing" | "removedBlocks" | "removed">> = {},
): StateQueueResponse =>
  ({
    observedAt: at(0),
    confirmed: { headerHash: fake(confirmed), updatedAt: at(20) },
    depth: queued.length,
    linked: queued.length,
    oldest: queued.map((n, i) => block(n, 12 - i * 3)),
    newest: [],
    hidden: 0,
    committing: null,
    removed: 0,
    removedBlocks: [],
    maturityMs: null,
    ...extra,
  }) as unknown as StateQueueResponse;

const commit = (n: number, status: string) =>
  ({ headerHash: fake(n), status, blockTime: at(0) }) as StateQueueResponse["committing"];

export type DemoStep = { caption: string; queue: StateQueueResponse };

export const demoSteps = (now: number): readonly DemoStep[] => {
  opened = now;
  return steps();
};

const steps = (): readonly DemoStep[] => [
  {
    caption: "Blocks wait in line to merge into the confirmed chain.",
    queue: queue(1, [2, 3, 4]),
  },
  {
    caption: "A new block is on its way to Cardano.",
    queue: queue(1, [2, 3, 4], { committing: commit(5, "pending_submission") }),
  },
  {
    caption: "Its commit is sent to Cardano.",
    queue: queue(1, [2, 3, 4], { committing: commit(5, "submitted_unconfirmed") }),
  },
  { caption: "It joins the line.", queue: queue(1, [2, 3, 4, 5]) },
  {
    caption: "The oldest block merges. It is now part of the confirmed chain.",
    queue: queue(2, [3, 4, 5]),
  },
  {
    caption: "A block can be taken out of the line.",
    queue: queue(2, [3, 4], { removed: 1, removedBlocks: [block(5, 1)] }),
  },
  {
    caption: "When nothing changes, nothing moves.",
    queue: queue(2, [3, 4], { removed: 1, removedBlocks: [block(5, 1)] }),
  },
];
