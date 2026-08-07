import { config } from "../config";
import { logger } from "../logger";
import { getSyncCursor, setSyncCursor } from "./db";
import { deleteFromBlockHeight, ingestTxInfos } from "./ingest";
import { fetchAddressTxs as realFetchAddressTxs, fetchTxInfo as realFetchTxInfo } from "./koios";
import { loadManifest } from "./manifest";

const SOURCE = "l1";

export type SyncDeps = {
  fetchAddressTxs: typeof realFetchAddressTxs;
  fetchTxInfo: typeof realFetchTxInfo;
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

  const { validators } = loadManifest(config.MIDGARD_MANIFEST_PATH);
  const addresses = validators.map((v) => v.address);

  const cursor = await getSyncCursor(SOURCE);
  const scanFloor = Math.max(
    0,
    (cursor?.lastBlockHeight ?? 0) - config.L1_REORG_LOOKBACK_BLOCKS,
  );

  const rows = await fetchAddressTxs(addresses, scanFloor);

  // Delete before writing: a transaction that vanished from the chain has no
  // row in `rows` and would otherwise survive forever.
  await deleteFromBlockHeight(scanFloor);

  const hashes = [...new Set(rows.map((r) => r.tx_hash))];
  const infos = hashes.length > 0 ? await fetchTxInfo(hashes) : [];
  const result = await ingestTxInfos(infos, validators);

  // Never let an empty window move the cursor. Seeding the reduce with
  // scanFloor would write back (cursor - lookback) whenever the scan finds
  // nothing, so the cursor walks backward one lookback per poll and each tick
  // re-scans an ever-wider range from Koios. Self-healing, but pure waste.
  const tip =
    rows.length > 0
      ? rows.reduce((max, r) => Math.max(max, r.block_height), scanFloor)
      : (cursor?.lastBlockHeight ?? scanFloor);
  await setSyncCursor(SOURCE, tip);

  logger.info(
    `L1 sync: scanned ${rows.length} rows from height ${scanFloor}, wrote ${result.txs} txs, ${result.events} events, ${result.headers} headers`,
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

/** Background loop. Failures are logged and retried on the next tick: sync
 * problems must never take down the read path. */
export function startSync(): void {
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
