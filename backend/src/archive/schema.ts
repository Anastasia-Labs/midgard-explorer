import { z } from "zod";

/** The writer holding the archive, and its fencing token. */
export const Lease = z.object({
  owner: z.string().min(1),
  host: z.string(),
  pid: z.number().int(),
  /** Epoch milliseconds, by the holder's clock. */
  expiresAt: z.number().int(),
  /** Rises by one on every takeover. A publish carries it. */
  fence: z.number().int().positive(),
});
export type Lease = z.infer<typeof Lease>;

export const Head = z.object({ generationKey: z.string(), n: z.number().int().positive() });
export type Head = z.infer<typeof Head>;

/**
 * The one mutable object. Lease and head live together so that a takeover and
 * a publish are both swaps of the same object: neither can land between the
 * other's read and its write.
 */
export const Control = z.object({ lease: Lease.nullable(), head: Head.nullable() });
export type Control = z.infer<typeof Control>;

/** One archived block in the published list, from its verified header.
 * `children` are the archived blocks that name it as their parent. */
export const BlockIndexEntry = z.object({
  headerHash: z.string(),
  prevHeaderHash: z.string(),
  manifestKey: z.string(),
  /** POSIX milliseconds, as decimal strings, from the header. */
  startTime: z.string(),
  endTime: z.string(),
  counts: z.object({
    transactions: z.string(),
    deposits: z.string(),
    withdrawals: z.string(),
    forcedTransactions: z.string(),
  }),
  /** Transaction records the archive holds for the block, which can differ
   * from the count its header states. */
  archivedTransactions: z.number().int().nonnegative(),
  children: z.array(z.string()).default([]),
});
export type BlockIndexEntry = z.infer<typeof BlockIndexEntry>;

/** One (transaction, block) observation in the published list. */
export const TxIndexEntry = z.object({
  txId: z.string(),
  headerHash: z.string(),
  observationKey: z.string(),
  /** The record's position in its block's transactions. */
  index: z.number().int().nonnegative(),
  endTime: z.string(),
});
export type TxIndexEntry = z.infer<typeof TxIndexEntry>;

/** An ordered list cut into immutable pages, and where each header sits. */
export const ListIndex = z.object({
  pages: z.array(z.string()),
  count: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
});
export type ListIndex = z.infer<typeof ListIndex>;

const EMPTY_LIST = { pages: [], count: 0, pageSize: 50 };

export const Indexes = z.object({
  blocks: ListIndex.default(EMPTY_LIST),
  transactions: ListIndex.default(EMPTY_LIST),
  /** headerHash -> the blocks page holding its entry. */
  blockPage: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type Indexes = z.infer<typeof Indexes>;

export const emptyIndexes = (): Indexes => ({ blocks: { ...EMPTY_LIST }, transactions: { ...EMPTY_LIST }, blockPage: {} });

/** What a published generation names. Every key in `references` exists before
 * the generation is published. */
export const Generation = z.object({
  n: z.number().int().positive(),
  parent: z.string().nullable(),
  fence: z.number().int().positive(),
  references: z.array(z.string()),
  seeds: z.array(z.unknown()).default([]),
  outcomes: z.record(z.string(), z.unknown()).default({}),
  coverage: z.record(z.string(), z.unknown()).default({}),
  metrics: z.record(z.string(), z.string()).default({}),
  index: Indexes.default(() => emptyIndexes()),
});
export type Generation = z.infer<typeof Generation>;
