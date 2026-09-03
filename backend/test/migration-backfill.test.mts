import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reachable as isReachable } from "./helpers/reachable.mjs";
import { readFileSync } from "node:fs";
import { indexerPrisma } from "../src/indexer/db.js";

/**
 * The backfill that repairs the block key, run as the migration ships it.
 *
 * The statement is READ OUT OF THE MIGRATION FILE rather than copied here. A
 * copy would pass forever while the shipped migration drifted away from it,
 * which is the same failure mode as a fixture that serves a shape the backend
 * does not produce: the test would be checking itself.
 *
 * What it proves is the one claim the rollout rests on. Every header the index
 * attributed to a commit transaction can be re-keyed from the `MBLC` token that
 * transaction minted, without a rescan and without contacting Koios, because the
 * tokens are already stored.
 */

const MIGRATION =
  "../prisma-indexer/migrations/20260902190000_canonical_header_and_binding/migration.sql";

/**
 * The backfill statement, read out of the shipped migration rather than copied.
 *
 * Located by the start of its CTE chain and the end of the UPDATE it feeds. The
 * marker was `WITH minted AS` until the CTE gained a policy-scoping step in
 * front of it, at which point every case in this file failed with "no longer
 * contains the backfill CTE" rather than silently testing nothing. That is the
 * behaviour to keep: a test that reads a file must fail loudly when the shape
 * it depends on moves.
 */
function backfillStatement(): string {
  const sql = readFileSync(new URL(MIGRATION, import.meta.url), "utf8");
  const start = sql.indexOf("WITH policy_use AS");
  expect(start, "the migration no longer contains the backfill CTE").toBeGreaterThan(-1);
  const end = sql.indexOf(";", sql.indexOf('h."header_hash" !~', start));
  return sql.slice(start, end + 1);
}

const ROOT = "f671fe1d677219f81f40d99329a349654f71671302dddd48f3b5e8d141ea10a8";
const HEADER = "6f77bd238790f437971176e41b6c04ecf8eb04af01cf6c8fedfbcc8b";
const OTHER_HEADER = "d19d28c8f4202131b06f75d3029dac9854343d8a23fe7646ee578a55";
const TX = "7fbb05d40afa53d1d2646e5e6652bebc92a4abec2e11eaa5a8bb5d470a48264e";
const POLICY = "1e5769e8fd8e777c5995e9cbec5ef30b81abc3b36f78a8606332d19a";

let reachable = false;

beforeAll(async () => {
  reachable = await isReachable("index", "migration backfill");
});

afterEach(async () => {
  if (!reachable) return;
  await indexerPrisma.$executeRawUnsafe(`DELETE FROM l1_tx_asset WHERE tx_hash = $1;`, TX);
  await indexerPrisma.$executeRawUnsafe(`DELETE FROM l1_block_header WHERE l1_tx_hash = $1;`, TX);
  await indexerPrisma.$executeRawUnsafe(`DELETE FROM l1_tx WHERE tx_hash = $1;`, TX);
  // Leave the schema as it was found. The seed re-adds the constraint NOT VALID
  // so it does not have to re-check rows it never touched; validating it here
  // means the next test in this database sees exactly what ships.
  await indexerPrisma.$executeRawUnsafe(
    `ALTER TABLE l1_block_header VALIDATE CONSTRAINT l1_block_header_header_hash_width;`,
  );
});

/**
 * Seeds a header keyed the OLD way, which the shipped constraint now forbids.
 *
 * The constraint is dropped for the duration and restored afterwards, because
 * the state under test is one the schema no longer permits: that is the point of
 * a migration, and a test that could not create the broken state could not prove
 * the repair.
 */
async function seedMisKeyedHeader(
  mints: Array<{ name: string; quantity: number; policy?: string }>,
) {
  await indexerPrisma.$executeRawUnsafe(
    `ALTER TABLE l1_block_header DROP CONSTRAINT IF EXISTS l1_block_header_header_hash_width;`,
  );
  try {
    // The assets hang off a transaction, so the parent row comes first.
    await indexerPrisma.$executeRawUnsafe(
      `INSERT INTO l1_tx (tx_hash, block_height, block_hash, slot, epoch, tx_time,
         fee, size, total_output, block_index, cert_deposit)
       VALUES ($1, 5050852, 'aa', 1, 1, now(), 0, 0, 0, 0, 0)
       ON CONFLICT (tx_hash) DO NOTHING;`,
      TX,
    );
    await indexerPrisma.$executeRawUnsafe(
      `INSERT INTO l1_block_header
         (header_hash, l1_tx_hash, block_height, prev_utxos_root, utxos_root,
          withdrawals_root, forced_transactions_root, transactions_root, deposits_root,
          transition_trace_root, event_to_step_root, withdrawal_count,
          forced_transaction_count, l2_transaction_count, deposit_count,
          total_event_count, transition_step_count, start_time, end_time,
          prev_header_hash, operator_vkey, protocol_version)
       VALUES ($1, $2, 5050852, '', $1, '', '', '', '', '', '',
               0, 0, 0, 0, 0, 0, 0, 0, '', '', 1);`,
      ROOT,
      TX,
    );
    for (const mint of mints) {
      await indexerPrisma.$executeRawUnsafe(
        `INSERT INTO l1_tx_asset (tx_hash, io_id, kind, policy_id, asset_name, quantity)
         VALUES ($1, NULL, 'mint', $2, $3, $4);`,
        TX,
        mint.policy ?? POLICY,
        mint.name,
        mint.quantity,
      );
    }
  } finally {
    await indexerPrisma.$executeRawUnsafe(
      `ALTER TABLE l1_block_header ADD CONSTRAINT l1_block_header_header_hash_width
         CHECK (header_hash ~ '^[0-9a-f]{56}$') NOT VALID;`,
    );
  }
}

const keyOf = async (l1TxHash: string): Promise<string | undefined> => {
  const rows = await indexerPrisma.$queryRawUnsafe<Array<{ header_hash: string }>>(
    `SELECT header_hash FROM l1_block_header WHERE l1_tx_hash = $1;`,
    l1TxHash,
  );
  return rows[0]?.header_hash;
};

describe("the shipped backfill", () => {
  it("re-keys a header from the token its commit transaction minted", async () => {
    if (!reachable) return;
    await seedMisKeyedHeader([{ name: `4d424c43${HEADER}`, quantity: 1 }]);
    expect(await keyOf(TX)).toBe(ROOT);

    await indexerPrisma.$executeRawUnsafe(backfillStatement());

    expect(await keyOf(TX)).toBe(HEADER);
  });

  it("produces a key of the width every route validates", async () => {
    if (!reachable) return;
    await seedMisKeyedHeader([{ name: `4d424c43${HEADER}`, quantity: 1 }]);
    await indexerPrisma.$executeRawUnsafe(backfillStatement());
    expect(await keyOf(TX)).toMatch(/^[0-9a-f]{56}$/);
  });

  /** Ambiguity is refused, not resolved. A transaction minting two block tokens
   * gives no way to choose, and picking the first would attribute half of them
   * to the wrong block while looking entirely reasonable. */
  it("leaves a row alone when the transaction minted two block tokens", async () => {
    if (!reachable) return;
    await seedMisKeyedHeader([
      { name: `4d424c43${HEADER}`, quantity: 1 },
      { name: `4d424c43${OTHER_HEADER}`, quantity: 1 },
    ]);
    await indexerPrisma.$executeRawUnsafe(backfillStatement());
    expect(await keyOf(TX)).toBe(ROOT);
  });

  it("leaves a row alone when nothing was minted", async () => {
    if (!reachable) return;
    await seedMisKeyedHeader([]);
    await indexerPrisma.$executeRawUnsafe(backfillStatement());
    expect(await keyOf(TX)).toBe(ROOT);
  });

  /** A burn names a block leaving the queue, not one being committed. */
  it("ignores a burned token", async () => {
    if (!reachable) return;
    await seedMisKeyedHeader([{ name: `4d424c43${HEADER}`, quantity: -1 }]);
    await indexerPrisma.$executeRawUnsafe(backfillStatement());
    expect(await keyOf(TX)).toBe(ROOT);
  });

  /** Idempotent, because a migration that ran twice must not move a key that is
   * already correct onto something else. */
  it("is a no-op the second time", async () => {
    if (!reachable) return;
    await seedMisKeyedHeader([{ name: `4d424c43${HEADER}`, quantity: 1 }]);
    await indexerPrisma.$executeRawUnsafe(backfillStatement());
    await indexerPrisma.$executeRawUnsafe(backfillStatement());
    expect(await keyOf(TX)).toBe(HEADER);
  });
});

describe("a foreign policy cannot supply the header hash", () => {
  /**
   * The adversarial case, and the gap this backfill had.
   *
   * `MBLC` is four bytes any policy may mint. The first version of this
   * migration matched on that prefix alone, so a token minted under an
   * unrelated policy in the same transaction either made the row ambiguous or,
   * if it were the only candidate, supplied a header hash under a key the
   * width constraint would happily accept. The application rule was always
   * policy-bound; the migration was not.
   *
   * The live nine were unaffected, which is exactly why a rehearsal against
   * them could not have found this.
   */
  it("refuses to key a row when a foreign policy makes the source ambiguous", async () => {
    if (!reachable) return;
    const foreign = "ff".repeat(28);
    await seedMisKeyedHeader([
      { name: `4d424c43${HEADER}`, quantity: 1 },
      { name: `4d424c43${OTHER_HEADER}`, quantity: 1, policy: foreign },
    ]);

    await indexerPrisma.$executeRawUnsafe(backfillStatement());

    // Fail closed. With a single attributed commit the two policies are
    // indistinguishable by frequency, so the migration keys nothing and the
    // width constraint at the end refuses the whole migration. Refusing beats
    // keying a row on a guess: a wrong header hash is a well-formed value that
    // no later check can catch.
    expect(await keyOf(TX)).toBe(ROOT);
  });

  /** With more than one commit the genuine policy is the one present in all of
   * them, so a foreign token in a single transaction cannot outvote it. */
  it("prefers the policy present in every commit over an interloper", async () => {
    if (!reachable) return;
    const foreign = "ff".repeat(28);
    const SECOND_TX = "ab".repeat(32);
    await seedMisKeyedHeader([
      { name: `4d424c43${HEADER}`, quantity: 1 },
      { name: `4d424c43${OTHER_HEADER}`, quantity: 1, policy: foreign },
    ]);
    // A second commit that only the genuine policy minted in.
    await indexerPrisma.$executeRawUnsafe(
      `INSERT INTO l1_tx (tx_hash, block_height, block_hash, slot, epoch, tx_time,
         fee, size, total_output, block_index, cert_deposit)
       VALUES ($1, 5050853, 'bb', 2, 1, now(), 0, 0, 0, 0, 0)
       ON CONFLICT (tx_hash) DO NOTHING;`,
      SECOND_TX,
    );
    await indexerPrisma.$executeRawUnsafe(
      `INSERT INTO l1_tx_asset (tx_hash, io_id, kind, policy_id, asset_name, quantity)
       VALUES ($1, NULL, 'mint', $2, $3, 1);`,
      SECOND_TX,
      POLICY,
      `4d424c43${OTHER_HEADER}`,
    );
    await indexerPrisma.$executeRawUnsafe(
      `INSERT INTO l1_block_header
         (header_hash, l1_tx_hash, block_height, prev_utxos_root, utxos_root,
          withdrawals_root, forced_transactions_root, transactions_root, deposits_root,
          transition_trace_root, event_to_step_root, withdrawal_count,
          forced_transaction_count, l2_transaction_count, deposit_count,
          total_event_count, transition_step_count, start_time, end_time,
          prev_header_hash, operator_vkey, protocol_version)
       VALUES ($1, $2, 5050853, '', $1, '', '', '', '', '', '',
               0, 0, 0, 0, 0, 0, 0, 0, '', '', 1);`,
      OTHER_HEADER,
      SECOND_TX,
    );

    await indexerPrisma.$executeRawUnsafe(backfillStatement());
    expect(await keyOf(TX)).toBe(HEADER);

    await indexerPrisma.$executeRawUnsafe(`DELETE FROM l1_tx_asset WHERE tx_hash = $1;`, SECOND_TX);
    await indexerPrisma.$executeRawUnsafe(
      `DELETE FROM l1_block_header WHERE l1_tx_hash = $1;`,
      SECOND_TX,
    );
    await indexerPrisma.$executeRawUnsafe(`DELETE FROM l1_tx WHERE tx_hash = $1;`, SECOND_TX);
  });
});
