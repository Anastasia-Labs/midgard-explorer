/**
 * Re-classifies stored L1 events against the decoders currently in the tree.
 *
 * The indexer decodes a datum once, at ingest. A decoder that lands afterwards
 * therefore never reaches the rows already written: on 2026-08-18 the live
 * store held 20 scheduler events as `unknown` while a scheduler decoder was
 * already in the tree. This closes that gap without refetching anything,
 * because `l1_event.datum` keeps the raw payload.
 *
 * It reads only rows currently classified `unknown`, so a row the tree can
 * still not decode is left exactly as it is, and no already-named event can be
 * renamed by a run of this script.
 *
 * Dry run by default. Pass `--apply` to write.
 *
 *   pnpm redecode:l1                 report only
 *   pnpm redecode:l1 --apply         write the rows that now decode
 */
import { indexerPrisma } from "../src/indexer/db";
import { classifyOutput } from "../src/indexer/eventClassification";

const apply = process.argv.includes("--apply");

type Tally = { decoded: number; stillUnknown: number };

async function main() {
  const rows = await indexerPrisma.l1Event.findMany({
    where: { eventType: "unknown" },
    select: { txHash: true, outputIndex: true, validator: true, datum: true },
  });

  console.log(
    `redecode: ${rows.length} unknown event(s), ${apply ? "applying" : "dry run"}\n`,
  );

  const byValidator = new Map<string, Tally>();
  const writes: { txHash: string; outputIndex: number; eventType: string; decoded: unknown }[] = [];

  for (const row of rows) {
    const tally = byValidator.get(row.validator) ?? { decoded: 0, stillUnknown: 0 };
    const result = classifyOutput(row.validator, row.datum);
    if (result.eventType === "unknown") {
      tally.stillUnknown += 1;
    } else {
      tally.decoded += 1;
      writes.push({
        txHash: row.txHash,
        outputIndex: row.outputIndex,
        eventType: result.eventType,
        decoded: result.decoded,
      });
    }
    byValidator.set(row.validator, tally);
  }

  const validators = [...byValidator.entries()].sort(
    (a, b) => b[1].decoded + b[1].stillUnknown - (a[1].decoded + a[1].stillUnknown),
  );
  console.log("  validator                  now decoded   still unknown");
  for (const [validator, tally] of validators) {
    console.log(
      `  ${validator.padEnd(26)} ${String(tally.decoded).padStart(11)}   ${String(
        tally.stillUnknown,
      ).padStart(13)}`,
    );
  }

  if (!apply) {
    console.log(`\n${writes.length} row(s) would change. Re-run with --apply to write.`);
    return;
  }

  // One transaction: a partial backfill leaves the store in a state no run of
  // this script produced, and the next run cannot tell the difference.
  await indexerPrisma.$transaction(
    writes.map((w) =>
      indexerPrisma.l1Event.update({
        where: { txHash_outputIndex: { txHash: w.txHash, outputIndex: w.outputIndex } },
        data: { eventType: w.eventType, decoded: w.decoded as never },
      }),
    ),
  );
  console.log(`\n${writes.length} row(s) updated.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => indexerPrisma.$disconnect());
