import { indexerPrisma } from "./db";
import type { KoiosTxInfo } from "./koios";
import type { ValidatorEntry } from "./manifest";
import { decodeStateQueueDatum } from "./stateQueueDatum";
import { logger } from "../logger";

/** Outputs at addresses we do not track are ignored. A transaction commonly
 * touches a change address alongside the validator we care about. */
function validatorForAddress(
  address: string,
  validators: ValidatorEntry[],
): ValidatorEntry | undefined {
  return validators.find((v) => v.address === address);
}

export async function ingestTxInfos(
  infos: KoiosTxInfo[],
  validators: ValidatorEntry[],
): Promise<{ txs: number; events: number; headers: number }> {
  let txs = 0;
  let events = 0;
  let headers = 0;

  for (const info of infos) {
    // Decode every state-queue datum in this transaction first, so we can tell
    // the head header from the previous queue node it re-outputs. A header is
    // carried forward when a sibling's prevUtxosRoot equals its utxosRoot.
    const decoded = new Map<number, NonNullable<ReturnType<typeof decodeStateQueueDatum>>>();
    for (const [index, out] of info.outputs.entries()) {
      const v = validatorForAddress(out.payment_addr.bech32, validators);
      if (!v || v.family !== "stateQueue") continue;
      const d = out.inline_datum?.value ?? null;
      if (d === null) continue;
      const h = decodeStateQueueDatum(d);
      if (h) decoded.set(index, h);
    }
    const carriedForward = new Set<string>();
    for (const a of decoded.values()) {
      for (const b of decoded.values()) {
        if (a !== b && b.prevUtxosRoot === a.utxosRoot) carriedForward.add(a.utxosRoot);
      }
    }

    await indexerPrisma.l1Tx.upsert({
      where: { txHash: info.tx_hash },
      create: {
        txHash: info.tx_hash,
        blockHeight: info.block_height,
        blockHash: info.block_hash,
        slot: info.absolute_slot,
        epoch: info.epoch_no,
        txTime: new Date(info.tx_timestamp * 1000),
      },
      update: {
        blockHeight: info.block_height,
        blockHash: info.block_hash,
      },
    });
    txs += 1;

    for (const [index, out] of info.outputs.entries()) {
      const validator = validatorForAddress(
        out.payment_addr.bech32,
        validators,
      );
      if (!validator) continue;

      const datumValue = out.inline_datum?.value ?? null;
      const header =
        validator.family === "stateQueue" && datumValue !== null
          ? decodeStateQueueDatum(datumValue)
          : null;

      // An unrecognised datum is stored raw and flagged rather than dropped:
      // losing an event is worse than not understanding it yet.
      const eventType =
        header !== null
          ? "blockCommitment"
          : datumValue !== null
            ? "unknown"
            : "noDatum";

      if (eventType === "unknown") {
        logger.warn(
          `Undecoded datum at ${validator.family} output ${info.tx_hash}#${index}`,
        );
      }

      await indexerPrisma.l1Event.upsert({
        where: {
          txHash_outputIndex: { txHash: info.tx_hash, outputIndex: index },
        },
        create: {
          txHash: info.tx_hash,
          validator: validator.family,
          eventType,
          outputIndex: index,
          lovelace: BigInt(out.value),
          datum: datumValue as never,
        },
        update: { validator: validator.family, eventType },
      });
      events += 1;

      if (header) {
        const isHead = !carriedForward.has(header.utxosRoot);
        await indexerPrisma.l1BlockHeader.upsert({
          where: { headerHash: header.utxosRoot },
          create: {
            headerHash: header.utxosRoot,
            l1TxHash: isHead ? info.tx_hash : null,
            blockHeight: isHead ? info.block_height : null,
            ...header,
          },
          // Only a head observation may set attribution. A carried-forward
          // sighting must never overwrite the transaction that truly committed
          // the block, and must never clear it back to null either.
          update: isHead
            ? { l1TxHash: info.tx_hash, blockHeight: info.block_height }
            : {},
        });
        headers += 1;
      }
    }
  }

  return { txs, events, headers };
}

/** Reorg reconciliation: drop everything at or above a height so it can be
 * re-ingested from the chain's current view. Events cascade with their tx. */
export async function deleteFromBlockHeight(height: number): Promise<number> {
  // Headers carry their own blockHeight rather than relying on a foreign key,
  // because l1TxHash is null for a header only ever seen as carried forward.
  // Deleting by height reconciles a reorg without depending on attribution
  // being present. Headers with a null blockHeight are blocks learned about
  // indirectly, below the scan floor, and are deliberately kept.
  await indexerPrisma.l1BlockHeader.deleteMany({
    where: { blockHeight: { gte: height } },
  });
  const { count } = await indexerPrisma.l1Tx.deleteMany({
    where: { blockHeight: { gte: height } },
  });
  return count;
}
