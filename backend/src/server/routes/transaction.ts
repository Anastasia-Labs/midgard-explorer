import { Request, Response } from "express";
import { config } from "../../config";
import { getBlockFinalization, getLastTransactions } from "../../db/block";
import {
  getTotalTransactions,
  getTransaction,
  getTransactionsPage,
  getTxAdmission,
  getTxInclusion,
  getTxLifecycle,
} from "../../db/transaction";
import { findOutRef, findOutRefs } from "../../db/ledger";
import { readConsistently } from "../../db/consistent";
import { getDeploymentContext, getIndexSettlement } from "../../db/deployment";
import { transactionSettlement } from "../../db/association";
import {
  decodeTransaction,
  decodeTransactionSafe,
} from "../../decode/transaction";
import { canonicalHash, isHash32, toHex } from "../../utils";
import { parsePageParam } from "../validate";

export async function getTransactionRoute(req: Request, res: Response) {
  const raw = req.query.tx_hash;
  if (typeof raw !== "string" || raw.length === 0) {
    return res.status(400).json({ error: "Missing tx_hash query param." });
  }
  if (!isHash32(raw)) {
    return res.status(400).json({ error: "Invalid tx_hash." });
  }
  // Canonical before it reaches a query, for the same reason the block route
  // normalises: two stores, two comparison rules, one identifier.
  const txHash = canonicalHash(raw);

  // Body, admission and inclusion share one snapshot: they describe one
  // transaction at one moment, and reading them separately let a page show a
  // transaction as accepted and uncommitted while the node had already
  // committed it between two statements.
  // ONE snapshot for every node read this response makes.
  //
  // The first version of this wrapped the body, admission and inclusion and
  // then read finalization, lifecycle and the input outrefs outside, so the
  // response still composed four moments and the claim that it read at one
  // point in time was false. Threading a reader into the modules was only the
  // plumbing; the boundary is here, where the response is assembled.
  //
  // The CBOR decode sits inside because its outref resolution is a node read
  // and has to share the snapshot. That keeps a read-only transaction open for
  // the duration of one transaction's decode, which is bounded work on bytes
  // this statement already fetched.
  const {
    tx,
    admissionRecord,
    inclusionRow,
    finalization,
    lifecycle,
    decoded,
  } = await readConsistently(async (db) => {
    const [txRow, admission, inclusion] = await Promise.all([
      getTransaction(txHash, db),
      getTxAdmission(txHash, db),
      getTxInclusion(txHash, db),
    ]);
    const header = inclusion ? toHex(inclusion.header_hash) : null;
    const [settlement, life] = await Promise.all([
      header === null ? null : getBlockFinalization(header, db),
      txRow ? null : getTxLifecycle(txHash, admission, db),
    ]);
    const body = txRow
      ? await decodeTransaction(txRow.tx, (ref) => findOutRef(ref, db), {
          includeCbor: true,
          // Every input, reference input and output resolved in one statement.
          bulkLookup: (refs) => findOutRefs(refs, db),
        }).then(
          (view) => ({ view, error: null as string | null }),
          (error: unknown) => ({
            view: null,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      : { view: null, error: null as string | null };
    return {
      tx: txRow,
      admissionRecord: admission,
      inclusionRow: inclusion,
      finalization: settlement,
      lifecycle: life,
      decoded: body,
    };
  });
  const admission = admissionRecord
    ? {
        status: admissionRecord.status,
        firstSeenAt: admissionRecord.firstSeenAt,
        validationStartedAt: admissionRecord.validationStartedAt,
        terminalAt: admissionRecord.terminalAt,
        updatedAt: admissionRecord.updatedAt,
        attemptCount: admissionRecord.attemptCount,
        requestCount: admissionRecord.requestCount,
        submitSource: admissionRecord.submitSource,
      }
    : null;
  // Inclusion is what makes settlement reachable from a transaction, so it is
  // resolved for every outcome below, decodable or not.
  const inclusion = inclusionRow
    ? {
        height: inclusionRow.height,
        header_hash: toHex(inclusionRow.header_hash),
        time_stamp_tz: inclusionRow.time_stamp_tz,
      }
    : null;
  const headerHash = inclusionRow ? toHex(inclusionRow.header_hash) : null;
  // The index and the deployment context are a DIFFERENT database, so they
  // cannot join the node's snapshot and are read alongside it. That separation
  // is the whole reason an association carries an `asOf` for each side.
  const [context, indexed] = await Promise.all([
    getDeploymentContext(),
    headerHash === null
      ? Promise.resolve({
          indexHash: null,
          indexObservedAt: null,
          indexBlockHeight: null,
          indexAvailable: true,
          indexLagSeconds: null,
        })
      : getIndexSettlement(headerHash),
  ]);

  // Settlement travels through the block, never directly. The hash below is the
  // block's commitment transaction, which many transactions share; there is no
  // L1 transaction that represents this one.
  const association = transactionSettlement(
    {
      deploymentId: context.deploymentId,
      network: context.network,
      l2ObservedAsOf: context.freshness.observedAsOf,
    },
    txHash,
    headerHash,
    {
      nodeHash: finalization?.submitted_tx_hash ?? null,
      nodeStatus: finalization?.status ?? null,
      nodeObservedAt: finalization?.updatedAt?.toISOString() ?? null,
      ...indexed,
      identityVerified: context.identityState === "verified",
      // What the node's silence is worth. A snapshot cannot settle whether the
      // live node holds a finalization record it does not.
      nodeFreshness: context.freshness.state,
    },
  );

  const envelope = {
    txId: txHash,
    admission,
    inclusion,
    finalization,
    midgard: context,
    cardano: association,
  };

  if (!tx) {
    if (lifecycle?.status === "rejected") {
      return res.json({
        ...envelope,
        transaction: null,
        status: "rejected",
        rejection: {
          reasonCode: lifecycle.reasonCode,
          reasonDetail: lifecycle.reasonDetail,
          rejectedAt: lifecycle.rejectedAt,
        },
      });
    }
    if (lifecycle) {
      return res.json({
        ...envelope,
        transaction: null,
        status: lifecycle.status,
      });
    }
    return res.status(404).json({ error: "Transaction not found." });
  }

  const status =
    tx.source === "immutable" || tx.source === "journal"
      ? "committed"
      : tx.source === "processed_mempool"
        ? "pending_commit"
        : "accepted";

  // Decoded inside the snapshot above. Only this route carries the raw bytes:
  // a list route inlining them would multiply its response by the size of every
  // transaction on the page.
  if (decoded.view !== null) {
    const transaction = decoded.view;
    return res.json({
      ...envelope,
      transaction: {
        ...transaction,
        timestamp: tx.time_stamp_tz,
        pending: tx.pending,
      },
      status,
    });
  }

  {
    // The transaction exists and everything outside its body is known. Losing
    // the body is not a failed request, so the rest is still returned. The
    // failure is captured inside the snapshot above rather than thrown, so the
    // read transaction is not held open across an error path.
    return res.json({
      ...envelope,
      transaction: null,
      status,
      decodeError: {
        code: "undecodable_body",
        detail: decoded.error ?? "the transaction body could not be decoded",
      },
    });
  }
}

export async function getTotalTransactionsRoute(_req: Request, res: Response) {
  const total = await getTotalTransactions();
  return res.json({ total });
}

export async function getRecentTransactionsRoute(_req: Request, res: Response) {
  const rows = await getLastTransactions(config.RECENT_TRANSACTIONS_LIMIT);
  const payload = rows.map((row) => ({
    height: row.height,
    header_hash: toHex(row.header_hash),
    tx_id: toHex(row.tx_id),
    time_stamp_tz: row.time_stamp_tz,
    status: "committed",
  }));
  return res.json({ rows: payload });
}

export async function getTransactionsPageRoute(req: Request, res: Response) {
  const parsedPage = parsePageParam(req.params.page);
  if (!parsedPage.ok) return res.status(400).json({ error: parsedPage.error });
  const page = parsedPage.value;

  const { rows, hasNextPage, total, limit } = await getTransactionsPage(
    page,
    typeof req.query.status === "string" ? req.query.status : undefined,
  );
  const payload = await Promise.all(
    rows.map(async (row) => {
      const decoded = row.tx
        ? await decodeTransactionSafe(row.tx)
        : { transaction: null, error: null as string | null };
      return {
        height: row.height,
        header_hash: toHex(row.header_hash),
        tx_id: toHex(row.tx_id),
        time_stamp_tz: row.time_stamp_tz,
        status: row.committed ? "committed" : "pending_commit",
        finalization_status: row.finalization_status,
        transaction: decoded.transaction,
        decodeError: decoded.error,
      };
    }),
  );
  return res.json({ rows: payload, hasNextPage, total, limit });
}
