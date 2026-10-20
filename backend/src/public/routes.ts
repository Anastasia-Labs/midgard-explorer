import type { Request, RequestHandler, Response } from "express";
import { config } from "../config";
import { getDeploymentContext } from "../db/deployment";
import { decodeTransaction } from "../decode/transaction";
import { canonicalHash, isHash28, isHash32 } from "../utils";
import { parsePageParam } from "../server/validate";
import type { BlockIndexEntry, TxIndexEntry } from "../archive/schema";
import type { BlockLookup, BlockManifest, PageRecord } from "./archiveView";
import { publicContext } from "./context";
import { UpstreamError } from "./nodeClient";

/**
 * The public source's route handlers: archived blocks and transactions from
 * the explorer's archive, and live state from the node's public HTTP API.
 *
 * No handler here opens a database, fetches a DA payload or decodes one. A
 * transaction body is decoded from its own archived record, with the decoder
 * replica mode uses, and nothing resolves its inputs: there is no ledger to
 * resolve them against.
 */

/** The largest serialized response this source sends. A hosted function
 * caps responses near 4.5 MB; this keeps every page under it. */
export const PUBLIC_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

const iso = (ms: string): string => new Date(Number(ms)).toISOString();
const num = (value: string | undefined): number | null => (value === undefined ? null : Number(value));

/** A response that would not fit is refused with a typed reason, never cut. */
export const sendBounded = (res: Response, body: unknown, shrink?: () => unknown) => {
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  if (size(body) <= PUBLIC_RESPONSE_MAX_BYTES) return res.json(body);
  const smaller = shrink?.();
  if (smaller !== undefined && size(smaller) <= PUBLIC_RESPONSE_MAX_BYTES) return res.json(smaller);
  return res.status(503).set("Cache-Control", "no-store").json({ error: "This response is larger than the explorer serves.", unavailable: "response_too_large" });
};

const sendUpstream = (res: Response, error: UpstreamError) => {
  if (error.retryAfterSeconds !== null) res.set("Retry-After", String(error.retryAfterSeconds));
  return res
    .status(503)
    .set("Cache-Control", "no-store")
    .json({ error: "The Midgard node did not answer this read.", upstream: error.reason, retryAfterSeconds: error.retryAfterSeconds });
};

/** For a route the public source cannot answer, with the reason it cannot. */
export const unsupported = (reason: string): RequestHandler => (_req, res) => {
  res
    .status(501)
    .set("Cache-Control", "no-store")
    .json({ error: "The public source does not serve this.", unavailable: "unsupported_by_source", detail: reason });
};

const listRow = (e: BlockIndexEntry) => ({
  height: null,
  header_hash: e.headerHash,
  block_start_time: iso(e.startTime),
  block_end_time: iso(e.endTime),
  time_stamp_tz: iso(e.endTime),
  tx_count: Number(e.counts.transactions),
  header_l2_transaction_count: Number(e.counts.transactions),
  header_deposit_count: Number(e.counts.deposits),
  header_withdrawal_count: Number(e.counts.withdrawals),
  header_forced_transaction_count: Number(e.counts.forcedTransactions),
  materialized_l2_transaction_count: e.archivedTransactions,
  // In the public source: the explorer's archive holds this block's payload.
  payload_retained_locally: true,
  // No source here observes the node's journal or Cardano.
  finalization_status: "not_observed",
});

export const getPublicBlocksPage: RequestHandler = async (req, res) => {
  const parsed = parsePageParam(req.params.page, config.BLOCKS_PER_PAGE);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (typeof req.query.status === "string" && req.query.status !== "") {
    return unsupported("the archive holds no finalization status to filter by")(req, res, () => {});
  }
  const { view } = publicContext();
  const page = await view.blocksPage(parsed.value, config.BLOCKS_PER_PAGE);
  return res.json({ rows: page.rows.map(listRow), hasNextPage: page.hasNextPage, total: page.total, limit: config.BLOCKS_PER_PAGE, page: parsed.value });
};

export const getPublicRecentBlocks: RequestHandler = async (_req, res) => {
  const page = await publicContext().view.blocksPage(1, config.RECENT_BLOCKS_LIMIT);
  return res.json({ rows: page.rows.map((e) => ({ ...listRow(e), tx_id: null })) });
};

export const getPublicTotalBlocks: RequestHandler = async (_req, res) => {
  return res.json({ total: (await publicContext().view.blocksPage(1, 1)).total });
};

/** Record bytes: inline, or from the record's detail object. A record over
 * the detail budget is a link into the archived payload, which no request
 * path decodes. */
const recordBytes = async (record: PageRecord): Promise<{ bytes: Buffer | null; error: string | null }> => {
  if (record.value !== undefined) return { bytes: Buffer.from(record.value, "hex"), error: null };
  if (record.detailKey !== undefined) {
    const detail = await publicContext().view.detail(record.detailKey);
    return detail === null ? { bytes: null, error: "detail_object_missing" } : { bytes: Buffer.from(detail.value, "hex"), error: null };
  }
  return { bytes: null, error: "record_too_large_to_serve" };
};

const decodeRecord = async (record: PageRecord, inPage: boolean) => {
  // A block page decodes only what its page holds; a record in its own
  // detail object is opened on the transaction's page.
  if (inPage && record.value === undefined) {
    return { transaction: null, error: record.detailKey ? "in_detail_object" : "record_too_large_to_serve" };
  }
  const { bytes, error } = await recordBytes(record);
  if (bytes === null) return { transaction: null, error };
  try {
    return { transaction: await decodeTransaction(bytes), error: null };
  } catch (e) {
    return { transaction: null, error: e instanceof Error ? e.message : String(e) };
  }
};

const LINE = (state: string, reason: string | null = null, value: string | null = null, observation: unknown = null) => ({ state, value, reason, observation });

/** The nine block facts, each from its own evidence. Nothing here is a zero
 * or a guess: a fact no source observed is unknown, with the reason. */
export const blockEvidence = (manifest: BlockManifest, outcome: Extract<BlockLookup, { state: "archived" }>["outcome"]) => {
  const v = manifest.verification;
  const noQueue = "no_queue_observation";
  return {
    payloadIntegrity: LINE(v.payloadHash),
    headerBinding: LINE(v.headerBinding),
    roots: v.roots.state === "not_run" ? LINE("not_run", v.roots.reason ?? null) : LINE(v.roots.state),
    l1Observation: LINE("unknown", noQueue),
    daStatus: LINE("unknown", noQueue),
    maturity: LINE("unknown", noQueue),
    localApplication: LINE("unknown", "not_read_by_public_source"),
    merge: outcome === null ? LINE("unknown", noQueue) : LINE("recorded", outcome.evidence, outcome.outcome, outcome.observation),
    withdrawalPayment:
      manifest.header.withdrawalCount === "0" ? LINE("not_applicable", "no_withdrawals_in_block") : LINE("unknown", noQueue),
  };
};

const archiveState = (found: BlockLookup) =>
  found.state === "archived" || found.state === "awaiting"
    ? { state: found.state, at: null, reason: null }
    : found.state === "archiving"
      ? { state: "archiving", at: found.at, reason: null }
      : { state: "failed", at: found.at, reason: found.reason };

export const getPublicBlock: RequestHandler = async (req, res) => {
  const raw = req.query.header_hash;
  if (typeof raw !== "string" || raw.length === 0) return res.status(400).json({ error: "Missing header_hash query param." });
  if (!isHash28(raw)) return res.status(400).json({ error: "Invalid header_hash." });
  const headerHash = canonicalHash(raw);
  const pageParam = req.query.page === undefined ? 1 : Number(req.query.page);
  if (!Number.isSafeInteger(pageParam) || pageParam < 1) return res.status(400).json({ error: "Invalid page." });

  const { view } = publicContext();
  const [found, midgard] = await Promise.all([view.block(headerHash), getDeploymentContext()]);
  if (found === null) return res.status(404).json({ error: "Block not found." });
  if (found.state !== "archived") {
    return res.status(404).set("Cache-Control", "no-store").json({ error: "Block not archived.", archive: archiveState(found) });
  }

  const { manifest, entry, children, outcome } = found;
  const h = manifest.header;
  const pages = manifest.records.transactions?.pages ?? 0;
  const records = pages === 0 && pageParam === 1 ? [] : await view.records(manifest, "transactions", pageParam - 1);
  if (records === null) return res.status(404).json({ error: "No such page of this block's transactions." });

  const time = iso(h.endTime);
  const rows = await Promise.all(
    records.map(async (record) => {
      const decoded = await decodeRecord(record, true);
      return { height: null, header_hash: headerHash, tx_id: record.key, time_stamp_tz: time, transaction: decoded.transaction, decodeError: decoded.error };
    }),
  );
  const [prev, next] = [await view.entry(h.prevHeaderHash), children.length === 1 ? children[0]! : null];
  const body = {
    midgard,
    header: {
      header_hash: headerHash,
      height: null,
      block_start_time: iso(h.startTime),
      block_end_time: time,
      header_l2_transaction_count: num(h.l2TransactionCount),
      header_deposit_count: num(h.depositCount),
      header_withdrawal_count: num(h.withdrawalCount),
      header_forced_transaction_count: num(h.forcedTransactionCount),
      materialized_l2_transaction_count: entry.archivedTransactions,
      payload_retained_locally: true,
    },
    rows,
    da: {
      utxos_root: h.utxosRoot,
      transactions_root: h.transactionsRoot,
      deposits_root: h.depositsRoot,
      withdrawals_root: h.withdrawalsRoot,
      forced_transactions_root: h.forcedTransactionsRoot,
      transition_trace_root: h.transitionTraceRoot,
      event_to_step_root: h.eventToStepRoot,
      l2_transaction_count: Number(h.l2TransactionCount),
      deposit_count: Number(h.depositCount),
      withdrawal_count: Number(h.withdrawalCount),
      forced_transaction_count: Number(h.forcedTransactionCount),
      total_event_count: Number(h.totalEventCount),
      transition_step_count: Number(h.transitionStepCount),
      block_start_time: iso(h.startTime),
      block_end_time: time,
    },
    finalization: null,
    // The header states the previous UTxO root and its own; it states no base
    // for the other roots.
    commitments: {
      utxos: { base: h.prevUtxosRoot ?? null, expected: h.utxosRoot, changed: h.prevUtxosRoot === undefined ? null : h.prevUtxosRoot !== h.utxosRoot },
      transactions: { base: null, expected: h.transactionsRoot, changed: null },
      deposits: { base: null, expected: h.depositsRoot, changed: null },
      withdrawals: { base: null, expected: h.withdrawalsRoot, changed: null },
      forced_transactions: { base: null, expected: h.forcedTransactionsRoot, changed: null },
      transition_trace: { base: null, expected: h.transitionTraceRoot, changed: null },
      event_to_step: { base: null, expected: h.eventToStepRoot, changed: null },
    },
    // Links between archived blocks only. A block with two archived children
    // is a branch point, so it names no single next block.
    neighbours: {
      prev: prev === null ? null : { height: null, header_hash: prev.headerHash },
      next: next === null ? null : { height: null, header_hash: next },
    },
    // Event lists are not served by this source yet; the header's counts are.
    events: { deposits: [], withdrawals: [], forced_transactions: [] },
    archive: { state: "archived", at: null, reason: null },
    evidence: blockEvidence(manifest, outcome),
    outcome,
    transactionsPage: { page: pageParam, pages, records: entry.archivedTransactions },
  };
  return sendBounded(res, body, () => ({
    ...body,
    rows: rows.map((r) => ({ ...r, transaction: null, decodeError: r.transaction ? "omitted_response_limit" : r.decodeError })),
  }));
};

/** The newest archived block that carries this transaction, first. */
const byNewest = (entries: Array<BlockIndexEntry | null>) =>
  entries.filter((e): e is BlockIndexEntry => e !== null).sort((a, b) => Number(BigInt(b.endTime) - BigInt(a.endTime)));

export const getPublicTransaction: RequestHandler = async (req, res) => {
  const raw = req.query.tx_hash;
  if (typeof raw !== "string" || raw.length === 0) return res.status(400).json({ error: "Missing tx_hash query param." });
  if (!isHash32(raw)) return res.status(400).json({ error: "Invalid tx_hash." });
  const txId = canonicalHash(raw);
  const { view, node } = publicContext();
  const [observations, midgard] = await Promise.all([view.transaction(txId), getDeploymentContext()]);

  if (observations.length === 0) {
    // Not in any archived block: only the node can say where it is.
    let status;
    try {
      status = await node.txStatus(txId);
    } catch (error) {
      if (error instanceof UpstreamError) return sendUpstream(res, error);
      throw error;
    }
    if (status.status === "not_found") return res.status(404).json({ error: "Transaction not found." });
    return res.json({
      midgard,
      txId,
      status: status.status,
      admission: null,
      inclusion: null,
      finalization: null,
      transaction: null,
      ...(status.status === "rejected"
        ? { rejection: { reasonCode: status.reasonCode ?? null, reasonDetail: status.reasonDetail ?? null, rejectedAt: status.timestamps?.createdAt ?? null } }
        : {}),
    });
  }

  const blocks = byNewest(await Promise.all(observations.map((o) => view.entry(o.headerHash))));
  const newest = blocks[0]!;
  const observation = observations.find((o) => o.headerHash === newest.headerHash)!;
  const found = await view.block(newest.headerHash);
  if (found?.state !== "archived") throw new Error(`archived observation names ${newest.headerHash}, which is not archived`);
  const records = (await view.records(found.manifest, "transactions", observation.page)) ?? [];
  const record = records.find((r) => r.index === observation.index);
  const decoded = record ? await decodeRecord(record, false) : { transaction: null, error: "record_missing" };
  const envelope = {
    midgard,
    txId,
    // Carried by an archived block whose payload hashes to its header.
    status: "committed",
    admission: null,
    inclusion: { height: null, header_hash: newest.headerHash, time_stamp_tz: iso(newest.endTime) },
    finalization: null,
    archive: { blocks: blocks.map((b) => b.headerHash) },
  };
  const body =
    decoded.transaction === null
      ? { ...envelope, transaction: null, decodeError: { code: "undecodable", detail: decoded.error } }
      : { ...envelope, transaction: { ...decoded.transaction, timestamp: iso(newest.endTime) } };
  return sendBounded(res, body, () => ({ ...envelope, transaction: null, decodeError: { code: "too_large", detail: "omitted_response_limit" } }));
};

const txRow = async (e: TxIndexEntry, decode: boolean) => {
  const base = { height: null, header_hash: e.headerHash, tx_id: e.txId, time_stamp_tz: iso(e.endTime), status: "committed", finalization_status: "not_observed" };
  if (!decode) return base;
  const { view } = publicContext();
  const found = await view.block(e.headerHash);
  const observation = (await view.transaction(e.txId)).find((o) => o.headerHash === e.headerHash);
  const record =
    found?.state === "archived" && observation
      ? ((await view.records(found.manifest, "transactions", observation.page)) ?? []).find((r) => r.index === e.index)
      : undefined;
  const decoded = record ? await decodeRecord(record, true) : { transaction: null, error: "record_missing" };
  return { ...base, transaction: decoded.transaction, decodeError: decoded.error };
};

export const getPublicTransactionsPage: RequestHandler = async (req, res) => {
  const parsed = parsePageParam(req.params.page, config.TRANSACTIONS_PER_PAGE);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (typeof req.query.status === "string" && req.query.status !== "") {
    return unsupported("the archive holds archived transactions only")(req, res, () => {});
  }
  const page = await publicContext().view.transactionsPage(parsed.value, config.TRANSACTIONS_PER_PAGE);
  const rows = await Promise.all(page.rows.map((e) => txRow(e, true)));
  return sendBounded(res, { rows, hasNextPage: page.hasNextPage, total: page.total, limit: config.TRANSACTIONS_PER_PAGE, page: parsed.value });
};

export const getPublicRecentTransactions: RequestHandler = async (_req, res) => {
  const page = await publicContext().view.transactionsPage(1, config.RECENT_TRANSACTIONS_LIMIT);
  return res.json({ rows: await Promise.all(page.rows.map((e) => txRow(e, false))) });
};

export const getPublicTotalTransactions: RequestHandler = async (_req, res) => {
  return res.json({ total: (await publicContext().view.transactionsPage(1, 1)).total });
};

/** Exact hashes only: the archive has no prefix index. */
export const getPublicSearch: RequestHandler = async (req: Request, res: Response) => {
  const q = req.query.q;
  if (typeof q !== "string") return res.status(400).json({ error: "Missing q query param." });
  const value = q.trim().toLowerCase();
  const { view } = publicContext();
  const hits: unknown[] = [];
  if (isHash28(value) && (await view.entry(value)) !== null) hits.push({ kind: "block", headerHash: value, height: null });
  if (isHash32(value)) {
    const seen = await view.transaction(value);
    if (seen.length > 0) hits.push({ kind: "transaction", txId: value, height: null, headerHash: seen[0]!.headerHash });
  }
  const exact = isHash28(value) || isHash32(value);
  return res.json({ hits, minPrefix: 6, tooShort: false, ...(exact ? {} : { unsearched: ["prefix"] }) });
};
