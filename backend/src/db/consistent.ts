import { Prisma } from "../../prisma/explorer-client";
import { prisma } from "../db";
import { logger } from "../logger";

/**
 * One point in time per response.
 *
 * There was no transaction anywhere on the node read path: no `$transaction`,
 * no isolation level, no `BEGIN` in `db.ts`, in any of `db/*.ts`, or in any
 * route. A block page is roughly nine independent statements, six of them
 * concurrent, and each took its own snapshot. Against the primary that is a
 * mild inconsistency while the node writes. Against a streaming standby it is
 * sharper: replay advances between statements, so a header can be read at one
 * replay position and its finalization at another, manufacturing the
 * node-versus-index disagreement the association model exists to report
 * honestly from inside a single response.
 *
 * Scope is the aggregates and not every query. A route that issues one
 * statement already has one snapshot, and wrapping it would buy nothing and
 * cost a round trip.
 *
 * Two costs are accepted rather than hidden. Prisma runs an interactive
 * transaction's queries on ONE connection, so statements issued through
 * `Promise.all` inside `read` serialise; that is correct and slower, and the
 * answer is to combine related statements rather than to drop the transaction.
 * And a long read on a standby can be cancelled when replay needs the rows, so
 * these stay short and a known transient conflict is retried once.
 */

/** The client handed to work inside the transaction. Structurally the same as
 * `prisma` minus the lifecycle methods, so every existing query helper accepts
 * it unchanged and nothing has to be rewritten to be transactional. */
export type NodeReader = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/**
 * PostgreSQL cancels a standby query that holds back WAL replay past
 * `max_standby_streaming_delay`. It is transient by construction: the same
 * statement moments later reads a newer, settled snapshot.
 *
 * 40001 is serialization_failure, which is what a replay conflict surfaces as.
 * 40P01 is deadlock_detected. Nothing else is retried, because a retry that
 * cannot know why it failed is a way to run a broken query twice.
 */
const RETRYABLE = new Set(["40001", "40P01"]);

const isRetryable = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  typeof error.meta?.code === "string" &&
  RETRYABLE.has(error.meta.code);

/** Bounded jitter, so a burst of requests hitting one replay conflict does not
 * retry in lockstep and reproduce it. */
const backoffMs = () => 25 + Math.floor(Math.random() * 50);

const OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  // Short by policy. A reader that needs longer than this is not a page load,
  // and on a standby it is a query that will be cancelled anyway.
  timeout: 5_000,
  maxWait: 2_000,
} as const;

/**
 * Runs `work` against one snapshot, retrying a replay conflict once.
 *
 * Read-only is set on the pool rather than per transaction: the node connection
 * already runs with `default_transaction_read_only=on`, so every statement here
 * is read-only whether or not this asked for it.
 */
export async function readConsistently<T>(
  work: (reader: NodeReader) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(work, OPTIONS);
  } catch (error) {
    if (!isRetryable(error)) throw error;
    logger.warn(
      `Standby read conflict, retrying once: ${String(error)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, backoffMs()));
    return await prisma.$transaction(work, OPTIONS);
  }
}
