import { Client } from "pg";
import { config } from "../config";
import { logger } from "../logger";

/** Chosen once and never derived from anything mutable: two processes sharing
 * this database must compute the same number to contend for the same lock. */
const SYNC_ADVISORY_LOCK = 4_017_260_827;

/**
 * Exclusive indexer leadership, on a connection of its own.
 *
 * Only one indexer at a time may write, across processes. The in-process guard
 * in `startSync` stops one process from overlapping itself and says nothing
 * about a second process pointed at the same database, where two passes can
 * delete and rewrite the same reorg window concurrently and the older chain
 * snapshot can commit last.
 *
 * A PostgreSQL advisory lock taken with `pg_try_advisory_lock` is scoped to the
 * SESSION that took it, so it lives exactly as long as the connection does.
 * Taking it through the Prisma pool therefore did not mean what it looked like:
 * the pool hands out whichever connection is free, closes one after
 * `DB_IDLE_TIMEOUT_MS`, and the lock went with it. Leadership was released
 * silently while the loop carried on writing, which is the same two-writer race
 * the lock exists to prevent.
 *
 * This holds a single `pg.Client` for the life of the process, and `verify()`
 * both keeps it warm and confirms it is still there before a pass is allowed to
 * write.
 */
export type Leadership = {
  /** Confirms the session holding the lock is still alive. A pass must not
   * write when this is false: the lock is gone and another process may hold
   * it. */
  verify: () => Promise<boolean>;
  release: () => Promise<void>;
};

export async function acquireLeadership(): Promise<Leadership | null> {
  const client = new Client({
    connectionString: config.INDEXER_POSTGRES_URL,
    application_name: "midgard-explorer-l1-indexer-lock",
    // A lock held on a connection that has quietly died is the failure this
    // module exists to avoid, so the connection is kept alive rather than left
    // to a network device's idle timeout.
    keepAlive: true,
  });

  try {
    await client.connect();
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked;",
      [SYNC_ADVISORY_LOCK],
    );
    if (rows[0]?.locked !== true) {
      await client.end().catch(() => undefined);
      return null;
    }
  } catch (err) {
    logger.error(`Could not acquire indexer leadership: ${String(err)}`);
    await client.end().catch(() => undefined);
    return null;
  }

  let lost = false;
  // An error on this connection means the session ended, and with it the lock.
  client.on("error", (err) => {
    lost = true;
    logger.error(
      `Indexer leadership connection failed, leadership is no longer held: ${String(err)}`,
    );
  });

  return {
    verify: async () => {
      if (lost) return false;
      try {
        await client.query("SELECT 1;");
        return true;
      } catch (err) {
        lost = true;
        logger.error(`Indexer leadership check failed: ${String(err)}`);
        return false;
      }
    },
    release: async () => {
      lost = true;
      await client.end().catch(() => undefined);
    },
  };
}
