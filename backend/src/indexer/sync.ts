import { config } from "../config";
import { logger } from "../logger";
import { getSyncCursor, indexerPrisma, setSyncCursor } from "./db";
import { deleteFromBlockHeight, ingestTxInfos } from "./ingest";
import {
  fetchAddressTxs as realFetchAddressTxs,
  fetchAssetTxs as realFetchAssetTxs,
  fetchPolicyAssets as realFetchPolicyAssets,
  fetchTxInfo as realFetchTxInfo,
} from "./koios";
import { loadManifest } from "./manifest";

const SOURCE = "l1";

export type SyncDeps = {
  fetchAddressTxs: typeof realFetchAddressTxs;
  fetchTxInfo: typeof realFetchTxInfo;
  // Injectable like the other two. The deployment sweep reaches the network,
  // so leaving it out of this seam made every sync test hit live Koios and
  // time out.
  fetchPolicyAssets: typeof realFetchPolicyAssets;
  fetchAssetTxs: typeof realFetchAssetTxs;
};

/**
 * One pass. Re-scans the last L1_REORG_LOOKBACK_BLOCKS so a rolled-back block
 * is noticed: everything at or above the scan floor is deleted and rewritten
 * from what the chain currently reports. Preprod reorgs are shallow, so a
 * fixed lookback beats a rollback log.
 */
export async function syncOnce(
  deps: Partial<SyncDeps> = {},
): Promise<{ scanned: number; ingested: number }> {
  const fetchAddressTxs = deps.fetchAddressTxs ?? realFetchAddressTxs;
  const fetchTxInfo = deps.fetchTxInfo ?? realFetchTxInfo;
  const fetchPolicyAssets = deps.fetchPolicyAssets ?? realFetchPolicyAssets;
  const fetchAssetTxs = deps.fetchAssetTxs ?? realFetchAssetTxs;

  const { validators, referenceScriptAuthPolicy } = loadManifest(config.MIDGARD_MANIFEST_PATH);
  const addresses = validators.map((v) => v.address);

  const cursor = await getSyncCursor(SOURCE);
  const scanFloor = Math.max(
    0,
    (cursor?.lastBlockHeight ?? 0) - config.L1_REORG_LOOKBACK_BLOCKS,
  );

  const rows = await fetchAddressTxs(addresses, scanFloor);

  const hashes = new Set(rows.map((r) => r.tx_hash));

  // Address scanning alone misses the transactions that PUT Midgard on chain.
  // Reference scripts are published to the deployer's own wallet address, so
  // no output of theirs sits at a validator address and no amount of address
  // scanning will ever see them. They are findable only by the auth token each
  // one carries. Measured on preprod 2026-08-07: 10 such transactions in
  // blocks 4939783 to 4939818, all of them invisible to the address scan,
  // whose earliest hit was block 4939843.
  //
  // Only swept on a full historical pass. These are one-time, immutable and
  // ancient; re-sweeping them every tick would spend dozens of Koios calls a
  // minute to re-learn the same answer.
  if (scanFloor === 0 && referenceScriptAuthPolicy !== null) {
    try {
      for (const assetName of await fetchPolicyAssets(referenceScriptAuthPolicy)) {
        for (const tx of await fetchAssetTxs(referenceScriptAuthPolicy, assetName)) {
          hashes.add(tx.tx_hash);
        }
      }
      logger.info(
        `L1 sync: deployment sweep over policy ${referenceScriptAuthPolicy} raised the ` +
          `scan set to ${hashes.size} transactions`,
      );
    } catch (err) {
      // A failed sweep must not lose the address scan's results, which are the
      // bulk of the data. The next full pass retries it.
      logger.error(`Reference script deployment sweep failed: ${String(err)}`);
    }
  }
  const hashList = [...hashes];
  const infos = hashList.length > 0 ? await fetchTxInfo(hashList) : [];

  // Never let an empty window move the cursor. Seeding the reduce with
  // scanFloor would write back (cursor - lookback) whenever the scan finds
  // nothing, so the cursor walks backward one lookback per poll and each tick
  // re-scans an ever-wider range from Koios. Self-healing, but pure waste.
  const tip =
    rows.length > 0
      ? rows.reduce((max, r) => Math.max(max, r.block_height), scanFloor)
      : (cursor?.lastBlockHeight ?? scanFloor);

  // Everything above is network and pure computation. Everything below is one
  // unit of work: clear the reorg window, rewrite it, move the cursor. The
  // delete used to run before the fetch, so a full rescan emptied the index and
  // only refilled it if Koios answered. A reader never sees that window now,
  // and a failed pass rolls back to the previous index rather than a hole.
  const result = await indexerPrisma.$transaction(
    async (tx) => {
      // A transaction that vanished from the chain has no row in `rows` and
      // would otherwise survive forever, so the window is still cleared first,
      // just inside the boundary.
      await deleteFromBlockHeight(scanFloor, tx);
      const written = await ingestTxInfos(infos, validators, tx);
      await setSyncCursor(SOURCE, tip, tx);
      return written;
    },
    // A full rescan writes every transaction, utxo, asset and redeemer in one
    // go. Prisma's 5 second default would abort it part way through.
    { maxWait: 15_000, timeout: 180_000 },
  );

  logger.info(
    `L1 sync: scanned ${rows.length} rows from height ${scanFloor}, wrote ` +
      `${result.txs} txs, ${result.events} events, ${result.headers} headers, ` +
      `${result.ios} utxos, ${result.assets} assets, ${result.redeemers} redeemers`,
  );
  return { scanned: rows.length, ingested: result.txs };
}

/**
 * Second line of defence behind the stub exclusion in manifest.ts. A validator
 * whose address saw traffic before this deployment existed is almost certainly
 * a placeholder script sharing an address with unrelated preprod activity.
 * This warns rather than excludes: a heuristic should never silently drop a
 * real validator, so a human decides what to do with the warning.
 */
export async function warnOnPreDeploymentActivity(
  deps: Partial<SyncDeps> = {},
): Promise<string[]> {
  const fetchAddressTxs = deps.fetchAddressTxs ?? realFetchAddressTxs;
  const { validators, createdAt } = loadManifest(config.MIDGARD_MANIFEST_PATH);
  const deployedAt = Date.parse(createdAt) / 1000;
  const suspicious: string[] = [];

  for (const v of validators) {
    const rows = await fetchAddressTxs([v.address], 0);
    const earliest = rows.reduce(
      (min, r) => Math.min(min, r.block_time),
      Number.POSITIVE_INFINITY,
    );
    if (rows.length > 0 && earliest < deployedAt) {
      suspicious.push(v.family);
      logger.warn(
        `Validator "${v.family}" at ${v.address} has activity from before this deployment (${new Date(earliest * 1000).toISOString()} < ${createdAt}). Likely a shared placeholder script rather than a real validator.`,
      );
    }
  }
  return suspicious;
}

/**
 * The cursor is DERIVED from the contents of l1_tx, so anything that empties
 * that table must reset the cursor in the same unit of work. A migration once
 * did `DELETE FROM l1_tx` with a comment promising the rows would be
 * "re-fetched on the next sync". They were not: the cursor still pointed near
 * chain tip, so every later pass scanned a 20 block window, found nothing,
 * wrote nothing, and logged success. The explorer sat empty and said it was
 * fine, which is the worst failure this system has.
 *
 * This is a boot-time safety net, deliberately NOT part of the tick loop. In
 * the loop, an empty RESULT is ordinary and must never trigger a rescan. Here
 * the signal is different and unambiguous: syncOnce only ever advances the
 * cursor to the height of rows it actually found, so a cursor above zero
 * proves rows once existed. If the table is now completely empty, they were
 * removed out of band and the cursor is lying.
 *
 * It warns loudly rather than healing quietly, because the underlying cause is
 * always a bug somewhere else.
 */
export async function healCursorIfDataWasWiped(): Promise<boolean> {
  const cursor = await getSyncCursor(SOURCE);
  if (!cursor || cursor.lastBlockHeight === 0) return false;

  const rows = await indexerPrisma.l1Tx.count();
  if (rows > 0) return false;

  logger.warn(
    `L1 sync cursor is at height ${cursor.lastBlockHeight} but l1_tx is empty. ` +
      `The data was removed without resetting the cursor, so history would never ` +
      `be re-fetched. Resetting the cursor to 0 to re-index from genesis.`,
  );
  await setSyncCursor(SOURCE, 0);
  return true;
}

/** Background loop. Failures are logged and retried on the next tick: sync
 * problems must never take down the read path. */
export function startSync(): void {
  void healCursorIfDataWasWiped().catch((err) =>
    logger.error(`Cursor consistency check failed: ${String(err)}`),
  );

  void warnOnPreDeploymentActivity().catch((err) =>
    logger.error(`Pre-deployment activity check failed: ${String(err)}`),
  );

  const tick = async () => {
    try {
      await syncOnce();
    } catch (err) {
      logger.error(`L1 sync failed, retrying next interval: ${String(err)}`);
    }
  };
  void tick();
  setInterval(tick, config.L1_SYNC_INTERVAL_MS).unref();
}
