import { Request, Response } from "express";
import { config } from "../../config";
import {
  getBlock,
  getBlockDaMetadata,
  getBlockEvents,
  getBlockHeader,
  getBlockHashByHeight,
  getBlockFinalization,
  getBlockNeighbours,
  getBlocksPage,
  getLastBlocks,
  getTotalBlocks,
} from "../../db/block";
import { getDeploymentContext, getIndexSettlement } from "../../db/deployment";
import { blockSettlement } from "../../db/association";
import { readConsistently } from "../../db/consistent";
import { decodeTransactionSafe } from "../../decode/transaction";
import { canonicalHash, isHash28, toHex } from "../../utils";
import { parsePageParam } from "../validate";

export async function getBlockByHeightRoute(req: Request, res: Response) {
  const height = Number(req.params.height);
  if (!Number.isSafeInteger(height) || height < 0) {
    return res.status(400).json({ error: "Invalid height." });
  }
  const hash = await getBlockHashByHeight(height);
  if (hash === null) {
    return res.status(404).json({ error: "Block not found." });
  }
  return res.json({ header_hash: toHex(hash) });
}

export async function getBlockRoute(req: Request, res: Response) {
  const raw = req.query.header_hash;
  if (typeof raw !== "string" || raw.length === 0) {
    return res.status(400).json({ error: "Missing header_hash query param." });
  }
  if (!isHash28(raw)) {
    return res.status(400).json({ error: "Invalid header_hash." });
  }
  // Normalised before either database sees it. The node stores bytea and reads
  // an uppercase hash happily; the explorer's index stores text and does not,
  // so an unnormalised identifier found the block and then reported its
  // Cardano evidence missing.
  const headerHash = canonicalHash(raw);

  // The six node reads share one snapshot, so a header cannot be read at one
  // point in time and its finalization at another. On a streaming standby that
  // is not hypothetical: replay advances between statements.
  //
  // The index read and the deployment context stay OUTSIDE it. They are a
  // different database, which can never share this snapshot, and holding a
  // standby transaction open across another database's round trip is how a
  // short read becomes a replay conflict.
  const nodeReads = readConsistently(async (db) =>
    Promise.all([
      getBlockHeader(headerHash, db),
      getBlock(headerHash, db),
      getBlockDaMetadata(headerHash, db),
      getBlockFinalization(headerHash, db),
      getBlockNeighbours(headerHash, db),
      getBlockEvents(headerHash, db),
    ]),
  );

  const [[header, rows, da, finalization, neighbours, events], context, indexed] =
    await Promise.all([
      nodeReads,
      getDeploymentContext(),
      // The Cardano side, fetched here rather than by the page. The frontend
      // used to request it separately and swallow every failure into "not
      // observed in the Cardano index yet", which turned a broken join into a
      // sentence about index lag and hid the defect for as long as it existed.
      getIndexSettlement(headerHash),
    ]);
  if (header === null) {
    return res.status(404).json({ error: "Block not found." });
  }

  const association = blockSettlement(
    {
      deploymentId: context.deploymentId,
      network: context.network,
      l2ObservedAsOf: context.freshness.observedAsOf,
    },
    headerHash,
    {
      nodeHash: finalization?.submitted_tx_hash ?? null,
      nodeStatus: finalization?.status ?? null,
      nodeObservedAt: finalization?.updatedAt?.toISOString() ?? null,
      ...indexed,
      // A difference only means something when both sources are known to
      // describe the same deployment.
      identityVerified: context.identityState === "verified",
      // What the node's silence is worth. A snapshot cannot settle whether the
      // live node holds a finalization record it does not.
      nodeFreshness: context.freshness.state,
    },
  );

  const payload = await Promise.all(
    rows.map(async (row) => {
      const decoded = row.tx
        ? await decodeTransactionSafe(row.tx)
        : { transaction: null, error: "Missing tx bytes." as string };
      return {
        height: row.height,
        header_hash: toHex(row.header_hash),
        tx_id: toHex(row.tx_id),
        time_stamp_tz: row.time_stamp_tz,
        transaction: decoded.transaction,
        decodeError: decoded.error,
      };
    }),
  );
  return res.json({
    midgard: context,
    cardano: association,
    header: {
      header_hash: toHex(header.header_hash),
      height: header.height,
      block_start_time: header.block_start_time,
      block_end_time: header.block_end_time,
      header_l2_transaction_count:
        header.header_l2_transaction_count === null
          ? null
          : Number(header.header_l2_transaction_count),
      header_deposit_count:
        header.header_deposit_count === null
          ? null
          : Number(header.header_deposit_count),
      header_withdrawal_count:
        header.header_withdrawal_count === null
          ? null
          : Number(header.header_withdrawal_count),
      header_forced_transaction_count:
        header.header_forced_transaction_count === null
          ? null
          : Number(header.header_forced_transaction_count),
      materialized_l2_transaction_count: Number(
        header.materialized_l2_transaction_count,
      ),
      payload_retained_locally: header.payload_retained_locally,
    },
    rows: payload,
    da,
    finalization,
    events: {
      deposits: events.deposits.map((row) => ({
        member_id: toHex(row.member_id),
        ordinal: row.ordinal,
        source_time_stamp_tz: row.source_time_stamp_tz,
      })),
      withdrawals: events.withdrawals.map((row) => ({
        member_id: toHex(row.member_id),
        ordinal: row.ordinal,
        source_time_stamp_tz: row.source_time_stamp_tz,
      })),
      forced_transactions: events.forcedTransactions.map((row) => ({
        member_id: toHex(row.member_id),
        ordinal: row.ordinal,
        source_time_stamp_tz: row.source_time_stamp_tz,
      })),
    },
    // Additive and nullable: a chain of one block has neither neighbour, and
    // the tip has no next.
    neighbours: {
      prev: neighbours.prev
        ? {
            height: neighbours.prev.height,
            header_hash: toHex(neighbours.prev.header_hash),
          }
        : null,
      next: neighbours.next
        ? {
            height: neighbours.next.height,
            header_hash: toHex(neighbours.next.header_hash),
          }
        : null,
    },
  });
}

export async function getRecentBlocksRoute(_req: Request, res: Response) {
  const rows = await getLastBlocks(config.RECENT_BLOCKS_LIMIT);
  const payload = rows.map((row) => ({
    height: row.height,
    header_hash: toHex(row.header_hash),
    tx_id: row.tx_id ? toHex(row.tx_id) : null,
    block_start_time: row.block_start_time,
    block_end_time: row.block_end_time,
    time_stamp_tz: row.block_end_time,
    tx_count: Number(row.header_l2_transaction_count),
    header_l2_transaction_count: Number(row.header_l2_transaction_count),
    header_deposit_count: Number(row.header_deposit_count),
    header_withdrawal_count: Number(row.header_withdrawal_count),
    header_forced_transaction_count: Number(
      row.header_forced_transaction_count,
    ),
    materialized_l2_transaction_count: Number(
      row.materialized_l2_transaction_count,
    ),
    payload_retained_locally: row.payload_retained_locally,
    finalization_status: row.finalization_status,
  }));
  return res.json({ rows: payload });
}

export async function getTotalBlocksRoute(_req: Request, res: Response) {
  const total = await getTotalBlocks();
  return res.json({ total });
}

export async function getBlocksPageRoute(req: Request, res: Response) {
  const parsedPage = parsePageParam(req.params.page);
  if (!parsedPage.ok) return res.status(400).json({ error: parsedPage.error });
  const page = parsedPage.value;

  const { rows, hasNextPage, total, limit } = await getBlocksPage(
    page,
    typeof req.query.status === "string" ? req.query.status : undefined,
  );
  const payload = rows.map((row) => ({
    height: row.height,
    header_hash: toHex(row.header_hash),
    block_start_time: row.block_start_time,
    block_end_time: row.block_end_time,
    time_stamp_tz: row.block_end_time,
    tx_count: Number(row.header_l2_transaction_count),
    header_l2_transaction_count: Number(row.header_l2_transaction_count),
    header_deposit_count: Number(row.header_deposit_count),
    header_withdrawal_count: Number(row.header_withdrawal_count),
    header_forced_transaction_count: Number(
      row.header_forced_transaction_count,
    ),
    materialized_l2_transaction_count: Number(
      row.materialized_l2_transaction_count,
    ),
    payload_retained_locally: row.payload_retained_locally,
    finalization_status: row.finalization_status,
  }));
  return res.json({ rows: payload, hasNextPage, total, limit });
}
