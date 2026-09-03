import { indexerPrisma, type IndexerTx } from "./db";
import type { KoiosAsset, KoiosPlutusContract, KoiosTxInfo, KoiosUtxo } from "./koios";
import type { ValidatorEntry } from "./manifest";
import { classifyOutput } from "./eventClassification";
import {
  headerHashFromStateQueueAssets,
  stateQueuePolicyId,
  type AssetRef,
} from "./stateQueueAsset";
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

  // Built in memory, written in four statements.
  //
  // This used to issue one INSERT per UTxO and one more per asset on each of
  // them, inside nested loops, so a transaction with 20 inputs each carrying 3
  // assets cost 80 round trips. Every one of them crosses the process boundary
  // and the sync loop repeats the work for every transaction in the reorg
  // window on every poll.
  const ioRows = sections.flatMap(([kind, utxos]) =>
    utxos.map((u, position) => ({
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
    })),
  );

  // `createManyAndReturn` because the assets below need the generated ids. The
  // rows are matched back by (kind, position), which the schema already makes
  // unique for a transaction, rather than by trusting the order they come back
  // in: a silent reordering would attach every asset to the wrong UTxO.
  const created = ioRows.length === 0 ? [] : await tx.l1TxIo.createManyAndReturn({ data: ioRows });
  const idByPosition = new Map(created.map((row) => [`${row.kind}:${row.position}`, row.id]));

  /**
   * The UTxO an asset was found in, or a refusal.
   *
   * `?? null` was fail-OPEN, and null is not a neutral value here: it is how a
   * MINT is represented, and `getL1Transaction` selects mints with
   * `where: { ioId: null }`. A lookup that missed therefore turned an output's
   * asset into something the read path reports as minted by the transaction.
   *
   * The lookup cannot legitimately miss: every key was inserted moments ago in
   * this same transaction. If one is absent, `createManyAndReturn` did not
   * return what it was given, and the honest response is to fail the pass and
   * leave the previous rows in place rather than write a plausible lie.
   */
  const ioIdFor = (kind: string, position: number): number => {
    const id = idByPosition.get(`${kind}:${position}`);
    if (id === undefined) {
      throw new Error(
        `No stored UTxO for ${info.tx_hash} ${kind}#${position}. The insert did ` +
          `not return every row it was given, so an asset cannot be attributed.`,
      );
    }
    return id;
  };

  /** `ioId` is the UTxO an asset sits in, or null for a mint, which belongs to
   * the transaction and to no UTxO. The two are spelled out here because the
   * null carries meaning and is not an absence. */
  type AssetRow = {
    txHash: string;
    ioId: number | null;
    kind: string;
    policyId: string;
    assetName: string;
    fingerprint: string | null;
    quantity: bigint;
  };

  const assetRows: AssetRow[] = sections.flatMap(([kind, utxos]) =>
    utxos.flatMap((u, position) =>
      u.asset_list.map((a) => ({
        txHash: info.tx_hash,
        ioId: ioIdFor(kind, position),
        kind,
        policyId: a.policy_id,
        assetName: a.asset_name ?? "",
        fingerprint: a.fingerprint,
        quantity: big(a.quantity),
      })),
    ),
  );

  // Mints belong to the transaction, not to any one UTxO, so ioId stays null.
  for (const a of info.assets_minted) {
    assetRows.push({
      txHash: info.tx_hash,
      ioId: null,
      kind: "mint",
      policyId: a.policy_id,
      assetName: a.asset_name ?? "",
      fingerprint: a.fingerprint,
      quantity: big(a.quantity),
    });
  }
  if (assetRows.length > 0) await tx.l1TxAsset.createMany({ data: assetRows });

  const redeemerRows = (info.plutus_contracts as KoiosPlutusContract[])
    .filter((c) => c.input?.redeemer)
    .map((c) => {
      const r = c.input!.redeemer!;
      return {
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
      };
    });
  if (redeemerRows.length > 0) await tx.l1Redeemer.createMany({ data: redeemerRows });

  return { ios: ioRows.length, assets: assetRows.length, redeemers: redeemerRows.length };
}

/** `deployment` is required rather than defaulted. It was previously left to
 * the column default, so every row landed under one shared value while the
 * validator query filtered on the manifest's real identity: events were
 * ingested correctly and no query could return them. A required parameter is
 * what stops that from being reintroduced by a caller that forgets. */
export async function ingestTxInfos(
  infos: KoiosTxInfo[],
  validators: ValidatorEntry[],
  deployment: string,
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

  // A minting policy id is a script hash, so this is stable for the deployment
  // and is resolved once rather than per output.
  const blockPolicyId = stateQueuePolicyId(validators);

  for (const info of infos) {
    // Which state-queue output is the new head, and which is the previous queue
    // node re-output alongside it. The head is the one whose block token this
    // transaction MINTED; the carried-forward node arrives as an input and is
    // paid back out, so its token is not minted here.
    //
    // This replaced a comparison of `prevUtxosRoot` against `utxosRoot` across
    // sibling outputs. That inferred the same answer from the datum, but it
    // could only ever yield a root, and a root is not the block's identity.
    const mintedHeaderHash =
      blockPolicyId === null
        ? null
        : headerHashFromStateQueueAssets(
            info.assets_minted.map(
              (a): AssetRef => ({
                policyId: a.policy_id,
                assetName: a.asset_name ?? "",
                quantity: big(a.quantity),
              }),
            ),
            blockPolicyId,
          );

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
      // An unrecognised datum is stored raw and flagged rather than dropped:
      // losing an event is worse than not understanding it yet. The same call
      // backs `scripts/redecode-l1-events.ts`, so a decoder landing later
      // reclassifies old rows exactly as it classifies new ones.
      const { eventType, decoded: decodedFields, header } = classifyOutput(
        validator.family,
        datumValue,
      );

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
          deployment,
          eventType,
          outputIndex: index,
          lovelace: BigInt(out.value),
          datum: datumValue as never,
          decoded: decodedFields as never,
        },
        // A re-ingest under a different manifest re-attributes the row rather
        // than leaving it under the identity it first arrived with.
        update: {
          validator: validator.family,
          deployment,
          eventType,
          decoded: decodedFields as never,
        },
      });
      events += 1;

      if (header) {
        // The identity comes from the token on THIS output, not from the
        // transaction's mints: the transaction carries the head and the node it
        // re-outputs, so a transaction-wide lookup has two candidates and no
        // way to choose between them.
        const candidate =
          blockPolicyId === null
            ? { ok: false as const, reason: "the manifest declares no stateQueue mint policy" }
            : headerHashFromStateQueueAssets(
                out.asset_list.map(
                  (a): AssetRef => ({
                    policyId: a.policy_id,
                    assetName: a.asset_name ?? "",
                    quantity: big(a.quantity),
                  }),
                ),
                blockPolicyId,
              );

        if (!candidate.ok) {
          // Refused rather than guessed. Writing a row under a key we cannot
          // prove is how the previous defect reached production: it looked like
          // data and joined to nothing.
          logger.warn(
            `No canonical header hash for state-queue output ` +
              `${info.tx_hash}#${index}: ${candidate.reason}. Skipping the header row.`,
          );
        } else {
          const isHead = mintedHeaderHash?.ok === true
            && mintedHeaderHash.headerHash === candidate.headerHash;
          await tx.l1BlockHeader.upsert({
            where: { headerHash: candidate.headerHash },
            create: {
              headerHash: candidate.headerHash,
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
