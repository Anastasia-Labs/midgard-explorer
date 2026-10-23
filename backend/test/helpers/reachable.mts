import { prisma } from "../../src/db.js";

/**
 * Is the database this file needs actually there?
 *
 * Every database-backed file asked this the same way and wrote out the same
 * answer: a bounded probe, a `reachable` flag, a REQUIRE_DB escape hatch and a
 * console warning. Nine copies of one idea, and the copies had already drifted
 * apart in probe timeout, in wording, and in whether REQUIRE_DB was honoured at
 * all, which is the part that decides whether CI can fail.
 *
 * The probe is BOUNDED because a stopped container on WSL2 black-holes TCP
 * rather than refusing it, so an unguarded query hangs past Vitest's hook
 * timeout and the file reports FAIL where it meant to skip. The race turns that
 * into a clean negative.
 *
 * REQUIRE_DB=1 turns every skip into a failure. That is what CI sets, and it is
 * the difference between a suite that proves something and a suite that reports
 * green for having done nothing.
 */
export async function reachable(
  which: "node",
  label: string,
  timeoutMs = 3000,
): Promise<boolean> {
  // One database. The explorer owned a second one for the Cardano index and
  // this helper took its name as an argument; the index is decommissioned and
  // the argument is kept so every call site still reads as a question about a
  // named database rather than about "the" database.
  const db = prisma;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1;`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return true;
  } catch (err) {
    if (process.env.REQUIRE_DB === "1") throw err;
    console.warn(`Skipping ${label}: ${which} Postgres unreachable. ${String(err)}`);
    return false;
  }
}
