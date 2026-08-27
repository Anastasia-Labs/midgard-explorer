import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { config } from "../src/config.js";
import { acquireLeadership } from "../src/indexer/leadership.js";

/**
 * The write lock, against a real PostgreSQL.
 *
 * The lifecycle tests use a fake leadership, so they prove what `startSync`
 * does with an answer, not that the answer is right. This proves the lock
 * itself: a second acquirer is refused while the first holds it, and the hold
 * survives a connection sitting idle.
 *
 * `pg_try_advisory_lock` is scoped to the SESSION that took it, which is why
 * this cannot go through the Prisma pool. The pool hands out whichever
 * connection is free and closes one after `DB_IDLE_TIMEOUT_MS`, so leadership
 * was released silently while the loop carried on writing: the exact two-writer
 * race the lock is taken to prevent.
 */

let reachable = false;

beforeAll(async () => {
  const probe = new Client({ connectionString: config.INDEXER_POSTGRES_URL });
  try {
    await Promise.race([
      probe.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("probe timed out")), 3000),
      ),
    ]);
    reachable = true;
    await probe.end();
  } catch {
    reachable = false;
    await probe.end().catch(() => undefined);
  }
});

afterAll(async () => {
  if (!reachable) return;
  // Any lock a failed case left behind dies with its connection, but say so
  // explicitly rather than relying on process exit.
  const cleanup = new Client({ connectionString: config.INDEXER_POSTGRES_URL });
  await cleanup.connect().catch(() => undefined);
  await cleanup.query("SELECT pg_advisory_unlock_all();").catch(() => undefined);
  await cleanup.end().catch(() => undefined);
});

describe("indexer leadership", () => {
  it("grants the lock to one holder and refuses a second", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    const first = await acquireLeadership();
    expect(first).not.toBeNull();
    try {
      // A second process pointed at the same database. Without this refusal,
      // two passes can delete and rewrite the same reorg window at once and the
      // older chain snapshot can commit last.
      const second = await acquireLeadership();
      expect(second).toBeNull();
    } finally {
      await first!.release();
    }
  });

  it("hands the lock on once the holder releases it", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    const first = await acquireLeadership();
    expect(first).not.toBeNull();
    await first!.release();

    const second = await acquireLeadership();
    expect(second).not.toBeNull();
    await second!.release();
  });

  it("confirms the lock is still held", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    const held = await acquireLeadership();
    expect(held).not.toBeNull();
    try {
      expect(await held!.verify()).toBe(true);
      // Twice, because verify also keeps the connection warm.
      expect(await held!.verify()).toBe(true);
    } finally {
      await held!.release();
    }
  });

  it("reports the lock as lost once the connection is gone", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    const held = await acquireLeadership();
    expect(held).not.toBeNull();
    // Releasing ends the session, so the lock is no longer held. A pass must
    // not write after this, which is what `verify` is asked before every pass.
    await held!.release();
    expect(await held!.verify()).toBe(false);
  });

  it("holds the lock on its own connection, not a pooled one", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    const held = await acquireLeadership();
    expect(held).not.toBeNull();
    try {
      const observer = new Client({
        connectionString: config.INDEXER_POSTGRES_URL,
      });
      await observer.connect();
      const { rows } = await observer.query<{ application_name: string }>(
        `SELECT a.application_name
           FROM pg_locks l
           JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND l.granted;`,
      );
      await observer.end();
      expect(rows.map((r) => r.application_name)).toContain(
        "midgard-explorer-l1-indexer-lock",
      );
    } finally {
      await held!.release();
    }
  });
});
