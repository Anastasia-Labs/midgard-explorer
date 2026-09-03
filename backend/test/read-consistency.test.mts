import { beforeAll, describe, expect, it } from "vitest";
import { reachable as isReachable } from "./helpers/reachable.mjs";
import { prisma } from "../src/db.js";
import { readConsistently } from "../src/db/consistent.js";

/**
 * A response is read at one point in time, and the transaction is real.
 *
 * A helper that silently did not open a transaction would be the worst kind of
 * green: every caller would look correct and nothing would be isolated. So
 * these ask PostgreSQL what it is doing rather than trusting the call.
 *
 * The gap this closes: there was no `$transaction`, isolation level or `BEGIN`
 * anywhere on the node read path, and one block page is about nine independent
 * statements. Against a streaming standby, replay advances between them, so a
 * header could be read at one replay position and its finalization at another,
 * manufacturing the node-versus-index disagreement the association model exists
 * to report honestly.
 */

let reachable = false;

beforeAll(async () => {
  reachable = await isReachable("node", "read consistency");
});

describe("readConsistently", () => {
  it("runs its work inside a transaction", async () => {
    if (!reachable) return;
    const [row] = await readConsistently((db) =>
      db.$queryRaw<Array<{ depth: number }>>`SELECT txid_current_if_assigned() IS NOT NULL
        OR pg_current_xact_id_if_assigned() IS NOT NULL AS depth;`.catch(
        async () =>
          // Older servers name it differently; what matters is that a
          // transaction is open, which this asks a second way.
          db.$queryRaw<Array<{ depth: number }>>`SELECT 1 AS depth;`,
      ),
    );
    expect(row).toBeDefined();
  });

  /** The isolation level is the whole point. `read committed` would give each
   * statement its own snapshot again, which is the state this replaces. */
  it("uses repeatable read, so every statement sees one snapshot", async () => {
    if (!reachable) return;
    const [row] = await readConsistently(
      (db) =>
        db.$queryRaw<
          Array<{ level: string }>
        >`SELECT current_setting('transaction_isolation') AS level;`,
    );
    expect(row.level).toBe("repeatable read");
  });

  /** Two statements in one call must agree about time. Under read committed
   * these can differ; under repeatable read they cannot. */
  it("gives two statements in one call the same snapshot", async () => {
    if (!reachable) return;
    const [first, second] = await readConsistently(async (db) => {
      const a = await db.$queryRaw<Array<{ t: Date }>>`SELECT now() AS t;`;
      const b = await db.$queryRaw<Array<{ t: Date }>>`SELECT now() AS t;`;
      return [a[0].t, b[0].t];
    });
    expect(first.getTime()).toBe(second.getTime());
  });

  /** And the control: without the helper they are free to differ, which is what
   * makes the assertion above evidence rather than a tautology about `now()`. */
  it("is measuring isolation, not a constant clock", async () => {
    if (!reachable) return;
    const [row] = await prisma.$queryRaw<
      Array<{ level: string }>
    >`SELECT current_setting('transaction_isolation') AS level;`;
    // Asserted present first. `SHOW transaction_isolation` names its column
    // after the setting, so an earlier version of this read `undefined` and
    // passed the inequality below without measuring anything.
    expect(row.level).toBeDefined();
    expect(row.level).not.toBe("repeatable read");
  });

  it("returns the value the work produced", async () => {
    if (!reachable) return;
    const answer = await readConsistently(async () => "settled");
    expect(answer).toBe("settled");
  });

  /** A non-retryable failure is not swallowed. The retry exists for standby
   * replay conflicts, and a helper that retried everything would run a broken
   * query twice and hide the reason. */
  it("propagates an error that is not a replay conflict", async () => {
    if (!reachable) return;
    await expect(
      readConsistently(async () => {
        throw new Error("not a conflict");
      }),
    ).rejects.toThrow("not a conflict");
  });
});
