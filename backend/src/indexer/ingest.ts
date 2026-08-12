import { indexerPrisma, type IndexerTx } from "./db";
import type { KoiosAsset, KoiosPlutusContract, KoiosTxInfo, KoiosUtxo } from "./koios";
import type { ValidatorEntry } from "./manifest";
import { decodeStateQueueDatum } from "./stateQueueDatum";
import { classifyEvent } from "./userEventDatum";
import { logger } from "../logger";

/** Outputs at addresses we do not track are ignored. A transaction commonly
 * touches a change address alongside the validator we care about. */
function validatorForAddress(
  address: string,
  validators: ValidatorEntry[],
): ValidatorEntry | undefined {
  return validators.find((v) => v.address === address);
}

/** Koios gives lovelace and ex-units as decimal strings. They exceed 2^53 in
 * the general case, so they go to BigInt directly and never through Number. */
const big = (v: string | number | null | undefined): bigint =>
  v === null || v === undefined ? 0n : BigInt(v);

/** Rewrites all detail for one transaction. Delete-then-insert rather than
 * upsert: a reorged transaction can come back with fewer inputs than before,
 * and an upsert would leave the surplus rows behind forever. The rows have no
 * stable natural key of their own, so there is nothing to upsert against. */
async function writeTxDetail(info: KoiosTxInfo, tx: IndexerTx): Promise<{
  ios: number; assets: number; redeemers: number;
}> {
  await tx.l1TxIo.deleteMany({ where: { txHash: info.tx_hash } });
  await tx.l1TxAsset.deleteMany({ where: { txHash: info.tx_hash } });
  await tx.l1Redeemer.deleteMany({ where: { txHash: info.tx_hash } });

  const sections: Array<[string, KoiosUtxo[]]> = [
    ["input", info.inputs],
    ["output", info.outputs],
    ["reference", info.reference_inputs],
    ["collateral", info.collateral_inputs],
    // The change returned when collateral is consumed. Koios reports it as a
    // single nullable UTxO rather than an array, which is how it stayed
    // validated but unread while every array section above was stored.
    ["collateral_output", info.collateral_output ? [info.collateral_output] : []],
  ];

  let ios = 0;
  let assets = 0;

  for (const [kind, utxos] of sections) {
    for (const [position, u] of utxos.entries()) {
      const io = await tx.l1TxIo.create({
        data: {
          txHash: info.tx_hash,
          kind,
          position,
          sourceTxHash: u.tx_hash,
          sourceIndex: u.tx_index,
          address: u.payment_addr?.bech32 ?? null,
          paymentCred: u.payment_addr?.cred ?? null,
          stakeAddr: u.stake_addr,
          lovelace: big(u.value),
          datumHash: u.datum_hash,
          inlineDatum: (u.inline_datum?.value ?? null) as never,
          refScriptHash: u.reference_script?.hash ?? null,
        },
      });
      ios += 1;
      for (const a of u.asset_list) {
        await tx.l1TxAsset.create({
          data: {
            txHash: info.tx_hash, ioId: io.id, kind,
            policyId: a.policy_id, assetName: a.asset_name ?? "",
            fingerprint: a.fingerprint, quantity: big(a.quantity),
          },
        });
        assets += 1;
      }
    }
  }

  // Mints belong to the transaction, not to any one UTxO, so ioId stays null.
  for (const a of info.assets_minted) {
    await tx.l1TxAsset.create({
      data: {
        txHash: info.tx_hash, ioId: null, kind: "mint",
        policyId: a.policy_id, assetName: a.asset_name ?? "",
        fingerprint: a.fingerprint, quantity: big(a.quantity),
      },
    });
    assets += 1;
  }

  let redeemers = 0;
  for (const c of info.plutus_contracts as KoiosPlutusContract[]) {
    const r = c.input?.redeemer;
    if (!r) continue;
    await tx.l1Redeemer.create({
      data: {
        txHash: info.tx_hash,
        scriptHash: c.script_hash,
        address: c.address,
        purpose: r.purpose,
        memUnits: big(r.unit.mem),
        stepUnits: big(r.unit.steps),
        fee: big(r.fee),
        datumHash: r.datum?.hash ?? null,
        datum: (r.datum?.value ?? null) as never,
        validContract: c.valid_contract,
        scriptSize: c.size,
      },
    });
    redeemers += 1;
  }

  return { ios, assets, redeemers };
}

export async function ingestTxInfos(
  infos: KoiosTxInfo[],
  validators: ValidatorEntry[],
  tx: IndexerTx = indexerPrisma,
): Promise<{
  txs: number; events: number; headers: number;
  ios: number; assets: number; redeemers: number;
}> {
  let txs = 0;
  let events = 0;
  let headers = 0;
  let ios = 0;
  let assetRows = 0;
  let redeemerRows = 0;

  for (const info of infos) {
    // Decode every state-queue datum in this transaction first, so we can tell
    // the head header from the previous queue node it re-outputs. A header is
    // carried forward when a sibling's prevUtxosRoot equals its utxosRoot.
    const decoded = new Map<number, NonNullable<ReturnType<typeof decodeStateQueueDatum>>>();
    for (const [index, out] of info.outputs.entries()) {
      const v = out.payment_addr
        ? validatorForAddress(out.payment_addr.bech32, validators)
        : undefined;
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

    const scalars = {
      blockHeight: info.block_height,
      blockHash: info.block_hash,
      slot: info.absolute_slot,
      epoch: info.epoch_no,
      txTime: new Date(info.tx_timestamp * 1000),
      fee: big(info.fee),
      size: info.tx_size,
      totalOutput: big(info.total_output),
      blockIndex: info.tx_block_index,
      certDeposit: big(info.deposit),
      invalidBefore: info.invalid_before === null ? null : big(info.invalid_before),
      invalidAfter: info.invalid_after === null ? null : big(info.invalid_after),
      metadata: (info.metadata ?? null) as never,
    };

    await tx.l1Tx.upsert({
      where: { txHash: info.tx_hash },
      create: { txHash: info.tx_hash, ...scalars },
      update: scalars,
    });
    txs += 1;

    const detail = await writeTxDetail(info, tx);
    ios += detail.ios;
    assetRows += detail.assets;
    redeemerRows += detail.redeemers;

    for (const [index, out] of info.outputs.entries()) {
      const validator = out.payment_addr
        ? validatorForAddress(out.payment_addr.bech32, validators)
        : undefined;
      if (!validator) continue;

      const datumValue = out.inline_datum?.value ?? null;
      const header =
        validator.family === "stateQueue" && datumValue !== null
          ? decodeStateQueueDatum(datumValue)
          : null;

      // An unrecognised datum is stored raw and flagged rather than dropped:
      // losing an event is worse than not understanding it yet.
      const user = header === null && datumValue !== null
        ? classifyEvent(validator.family, datumValue)
        : { eventType: "unknown", decoded: null };

      const eventType =
        header !== null
          ? "blockCommitment"
          : datumValue !== null
            ? user.eventType
            : "noDatum";

      if (eventType === "unknown") {
        logger.warn(
          `Undecoded datum at ${validator.family} output ${info.tx_hash}#${index}`,
        );
      }

      await tx.l1Event.upsert({
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
          decoded: user.decoded as never,
        },
        update: {
          validator: validator.family,
          eventType,
          decoded: user.decoded as never,
        },
      });
      events += 1;

      if (header) {
        const isHead = !carriedForward.has(header.utxosRoot);
        await tx.l1BlockHeader.upsert({
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

  return { txs, events, headers, ios, assets: assetRows, redeemers: redeemerRows };
}

/** Reorg reconciliation: drop everything at or above a height so it can be
 * re-ingested from the chain's current view. Events cascade with their tx. */
export async function deleteFromBlockHeight(
  height: number,
  tx: IndexerTx = indexerPrisma,
): Promise<number> {
  // Headers carry their own blockHeight rather than relying on a foreign key,
  // because l1TxHash is null for a header only ever seen as carried forward.
  // Deleting by height reconciles a reorg without depending on attribution
  // being present. Headers with a null blockHeight are blocks learned about
  // indirectly, below the scan floor, and are deliberately kept.
  await tx.l1BlockHeader.deleteMany({
    where: { blockHeight: { gte: height } },
  });
  const { count } = await tx.l1Tx.deleteMany({
    where: { blockHeight: { gte: height } },
  });
  return count;
}
