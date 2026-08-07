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
        await indexerPrisma.l1BlockHeader.upsert({
          where: { headerHash: header.utxosRoot },
          create: {
            headerHash: header.utxosRoot,
            l1TxHash: info.tx_hash,
            ...header,
          },
          update: { l1TxHash: info.tx_hash },
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
  const { count } = await indexerPrisma.l1Tx.deleteMany({
    where: { blockHeight: { gte: height } },
  });
  return count;
}
