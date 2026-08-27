import { config } from "../config";
import { logger } from "../logger";
import { getSyncCursor, indexerPrisma, setSyncCursor } from "./db";
import { deleteFromBlockHeight, ingestTxInfos } from "./ingest";
import {
  fetchAddressTxs as realFetchAddressTxs,
  fetchAssetTxs as realFetchAssetTxs,
  fetchEpochParams as realFetchEpochParams,
  fetchAccountUpdates as realFetchAccountUpdates,
  fetchPolicyAssets as realFetchPolicyAssets,
  fetchTxInfo as realFetchTxInfo,
} from "./koios";
import { loadManifest } from "./manifest";

const SOURCE = "l1";

/** Per-scan cursors for the sources address history cannot see. Each advances
 * only when its own scan completes, so one failing source cannot make another
 * look further ahead than it is. */
const SOURCE_MINTS = "l1:mints";
const SOURCE_REWARDS = "l1:rewards";

export type SyncDeps = {
  fetchAddressTxs: typeof realFetchAddressTxs;
  fetchTxInfo: typeof realFetchTxInfo;
  // Injectable like the other two. The deployment sweep reaches the network,
  // so leaving it out of this seam made every sync test hit live Koios and
  // time out.
  fetchPolicyAssets: typeof realFetchPolicyAssets;
  fetchAssetTxs: typeof realFetchAssetTxs;
  fetchAccountUpdates: typeof realFetchAccountUpdates;
  fetchEpochParams: typeof realFetchEpochParams;
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
  const fetchAccountUpdates = deps.fetchAccountUpdates ?? realFetchAccountUpdates;
  const fetchEpochParams = deps.fetchEpochParams ?? realFetchEpochParams;

  const { validators, referenceScriptAuthPolicy, deploymentId } = loadManifest(
    config.MIDGARD_MANIFEST_PATH,
  );
  const addresses = validators.map((v) => v.address);

  const cursor = await getSyncCursor(SOURCE);
  const scanFloor = Math.max(
    0,
    (cursor?.lastBlockHeight ?? 0) - config.L1_REORG_LOOKBACK_BLOCKS,
  );

  const rows = await fetchAddressTxs(addresses, scanFloor);

  const hashes = new Set(rows.map((r) => r.tx_hash));

  // Policy scan. Two things address history cannot see are found here, and
  // they turned out to be one scan rather than two.
  //
  // A minting policy id IS the script hash, and a mint need not touch the
  // enterprise address derived from that hash: hubOracleMint and
  // referenceScriptAuthMint have no Spend entry at all, so nothing is ever
  // paid to or spent from those addresses.
  //
  // Reference scripts are published to the deployer's own wallet, so none of
  // their outputs sit at a validator address either. Measured on preprod
  // 2026-08-07: 10 such transactions in blocks 4939783 to 4939818, none of them
  // visible to the address scan, whose earliest hit was 4939843. They carry a
  // token under the reference-script auth policy, which is itself one of the
  // Mint entries, so sweeping it separately scanned one policy twice per pass.
  //
  // Incremental from this source's own cursor, and the cursor moves only if
  // the whole scan finished. The gate used to be `scanFloor === 0`, which stops
  // being true a few blocks in, so a scan that failed once was never retried
  // despite an error handler that said the next full pass would.
  const mintCursor = (await getSyncCursor(SOURCE_MINTS))?.lastBlockHeight ?? 0;
  const policies = [
    ...new Set(
      [
        ...validators.map((v) => v.policyId),
        referenceScriptAuthPolicy,
      ].filter((id): id is string => id !== null),
    ),
  ];
  let mintTip = mintCursor;
  let mintsCompleted = false;
  try {
    for (const policyId of policies) {
      for (const assetName of await fetchPolicyAssets(policyId)) {
        for (const tx of await fetchAssetTxs(policyId, assetName, mintCursor)) {
          hashes.add(tx.tx_hash);
          mintTip = Math.max(mintTip, tx.block_height);
        }
      }
    }
    mintsCompleted = true;
  } catch (err) {
    // The address scan's results are the bulk of the data and must still
    // commit. No cursor is written, so the next tick tries the policies again.
    logger.error(`L1 policy scan failed, retrying next tick: ${String(err)}`);
  }

  // Withdraw executions. A withdraw-only validator ignores the transaction
  // entirely and is executed against the reward address derived from its script
  // hash, which shares no bytes with the payment address. Verified on preprod:
  // the phasMembership reward account is registered and its registration
  // transaction was absent from the index.
  const rewardAddresses = validators
    .map((v) => v.rewardAddress)
    .filter((addr): addr is string => addr !== null);
  let rewardsCompleted = false;
  try {
    for (const update of await fetchAccountUpdates(rewardAddresses)) {
      hashes.add(update.txHash);
    }
    rewardsCompleted = true;
  } catch (err) {
    logger.error(`L1 reward account scan failed, retrying next tick: ${String(err)}`);
  }

  const hashList = [...hashes];
  // Throws naming what is missing rather than returning a short list. The
  // window below is deleted and rewritten from this, so a partial answer
  // accepted here destroys history instead of merely omitting it.
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
      const written = await ingestTxInfos(infos, validators, deploymentId, tx);
      await setSyncCursor(SOURCE, tip, tx);
      // Each secondary source advances only if its own scan finished. A source
      // that threw leaves its cursor where it was and is retried, rather than
      // being carried forward by a sibling that happened to succeed.
      if (mintsCompleted) await setSyncCursor(SOURCE_MINTS, mintTip, tx);
      if (rewardsCompleted) await setSyncCursor(SOURCE_REWARDS, tip, tx);
      return written;
    },
    // A full rescan writes every transaction, utxo, asset and redeemer in one
    // go. Prisma's 5 second default would abort it part way through.
    { maxWait: 15_000, timeout: 180_000 },
  );

  // Outside the transaction above and allowed to fail on its own. These
  // parameters annotate what the indexer already wrote; a Koios outage here
  // must not roll back a completed chain scan, and a page with no parameters
  // shows units without a percentage rather than nothing at all.
  await refreshProtocolParams(fetchEpochParams);

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
/** Chosen once and never derived from anything mutable: two processes sharing
 * this database must compute the same number to contend for the same lock. */
const SYNC_ADVISORY_LOCK = 4_017_260_827;

/**
 * Only one indexer at a time may write, across processes.
 *
 * The in-process guard below stops one process from overlapping itself. It says
 * nothing about a second process pointed at the same database, where two passes
 * can delete and rewrite the same reorg window concurrently and the older chain
 * snapshot can commit last. A session-scoped advisory lock is held for the life
 * of the process and released when its connection ends, including on a crash.
 */
async function acquireLeadership(): Promise<boolean> {
  const [row] = await indexerPrisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${SYNC_ADVISORY_LOCK}::bigint) AS locked;`;
  return row?.locked === true;
}

export type SyncHandle = {
  /** Resolves once the loop has stopped and any pass in flight has finished.
   * Shutdown must await this before disconnecting Prisma, or a transaction is
   * cut mid-write. */
  stop: () => Promise<void>;
  /** Resolves when the bootstrap sequence has finished and the first pass has
   * been attempted. Exposed so a test does not have to sleep. */
  started: Promise<void>;
};

/**
 * Background loop, serialized end to end.
 *
 * Bootstrap runs in order rather than concurrently: cursor healing used to be
 * launched alongside the first pass, so a pass could read the stale cursor,
 * healing could reset it to zero, and the pass could then write the stale value
 * back over the reset.
 *
 * Passes never overlap. `setInterval` fires on a fixed period regardless of how
 * long a pass takes, and a scan with Koios retries can exceed the interval, so
 * two passes could delete and rewrite the same window at once. A timeout
 * scheduled after each pass finishes cannot do that.
 */
export function startSync(): SyncHandle {
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<unknown> = Promise.resolve();

  const started = (async () => {
    // Fail fast and loudly: an unreadable manifest means every row would be
    // attributed to an identity nobody can query back.
    try {
      loadManifest(config.MIDGARD_MANIFEST_PATH);
    } catch (err) {
      logger.error(`L1 sync not started, manifest is unusable: ${String(err)}`);
      return;
    }

    try {
      await healCursorIfDataWasWiped();
    } catch (err) {
      logger.error(`Cursor consistency check failed: ${String(err)}`);
    }

    if (!(await acquireLeadership().catch(() => false))) {
      logger.warn(
        "L1 sync not started: another process holds the indexer lock. " +
          "The read path is unaffected.",
      );
      return;
    }

    try {
      await warnOnPreDeploymentActivity();
    } catch (err) {
      logger.error(`Pre-deployment activity check failed: ${String(err)}`);
    }

    const tick = async () => {
      if (stopping) return;
      try {
        await syncOnce();
      } catch (err) {
        logger.error(`L1 sync failed, retrying next interval: ${String(err)}`);
      }
      if (stopping) return;
      timer = setTimeout(() => {
        inFlight = tick();
        void inFlight;
      }, config.L1_SYNC_INTERVAL_MS);
      timer.unref();
    };

    inFlight = tick();
    await inFlight;
  })();

  return {
    started,
    stop: async () => {
      stopping = true;
      if (timer) clearTimeout(timer);
      await started.catch(() => undefined);
      await inFlight.catch(() => undefined);
    },
  };
}

/** Records the current epoch's execution limits, upserted by epoch.
 *
 * History is kept rather than overwritten: a transaction is measured against
 * the parameters of its own epoch, and a single mutable row would restate old
 * figures against today's limits every time governance changed one.
 */
export async function refreshProtocolParams(
  fetch: typeof realFetchEpochParams = realFetchEpochParams,
): Promise<void> {
  await storeEpochParams(fetch);
  await backfillMissingProtocolParams(fetch);
}

async function storeEpochParams(
  fetch: typeof realFetchEpochParams,
  epochNo?: number,
): Promise<boolean> {
  try {
    const params = await fetch(epochNo);
    if (!params) return false;
    const { epochNo: observed, ...limits } = params;
    await indexerPrisma.l1ProtocolParams.upsert({
      where: { epochNo: observed },
      create: { epochNo: observed, ...limits },
      update: { ...limits, observedAt: new Date() },
    });
    return true;
  } catch (error) {
    logger.warn(`Could not read Cardano protocol parameters: ${String(error)}`);
    return false;
  }
}

/** Fills in the epochs the indexer already holds transactions for.
 *
 * Storing only the current epoch would leave every transaction indexed before
 * today without a limit to be measured against, which is most of them on a
 * first sync. The set is bounded by the epochs actually present in `l1_tx`,
 * so this asks for what a page can display and nothing else, and it stops
 * asking once an epoch is on record.
 */
export async function backfillMissingProtocolParams(
  fetch: typeof realFetchEpochParams = realFetchEpochParams,
): Promise<number> {
  const [present, known] = await Promise.all([
    indexerPrisma.l1Tx.findMany({ distinct: ["epoch"], select: { epoch: true } }),
    indexerPrisma.l1ProtocolParams.findMany({ select: { epochNo: true } }),
  ]);
  const have = new Set(known.map((row) => row.epochNo));
  const missing = present.map((row) => row.epoch).filter((epoch) => !have.has(epoch));

  let stored = 0;
  for (const epoch of missing) {
    if (await storeEpochParams(fetch, epoch)) stored += 1;
  }
  if (stored > 0) logger.info(`Recorded Cardano protocol parameters for ${stored} epoch(s)`);
  return stored;
}
