import {
  decodeAddressResponse,
  decodeAsset,
  decodeAssets,
  decodeMetrics,
} from "@midgard-explorer/contracts";
import {
  decodeBlockByHeight,
  decodeBlockResponse,
  decodeBlocksPage,
  decodeRecentBlocks,
  decodeTotal,
} from "@midgard-explorer/contracts";
import {
  decodeDepositsPage,
  decodeForcedTxsPage,
  decodeWithdrawalsPage,
} from "@midgard-explorer/contracts";
import {
  decodeRecentTxs,
  decodeTransactionResponse,
  decodeTxsPage,
} from "@midgard-explorer/contracts";
import { decodeL1Summary, decodeL1Transaction, decodeL1TxsPage } from "@midgard-explorer/contracts";
import { apiBase } from "./env";

export type ApiErrorCategory =
  | "network"
  | "timeout"
  | "http_400"
  | "http_404"
  | "http_422"
  | "http_5xx"
  | "http_other"
  | "malformed_response";

export class ApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly category: ApiErrorCategory,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly safeMessage: string,
    override readonly cause?: unknown,
  ) {
    super(`${endpoint}: ${category}${status !== null ? ` (${status})` : ""}`);
    this.name = "ApiError";
  }
}

export const categorize = (status: number): ApiErrorCategory =>
  status === 400
    ? "http_400"
    : status === 404
      ? "http_404"
      : status === 422
        ? "http_422"
        : status >= 500
          ? "http_5xx"
          : "http_other";

const SAFE_MESSAGES: Record<ApiErrorCategory, string> = {
  network: "The explorer API could not be reached.",
  timeout: "The explorer API took too long to respond.",
  http_400: "The request was not valid.",
  http_404: "Not found.",
  http_422: "This entry could not be decoded by the explorer.",
  http_5xx: "The explorer API had an internal error.",
  http_other: "Unexpected response from the explorer API.",
  malformed_response: "The explorer API returned data in an unexpected shape.",
};

export const isRetryable = (category: ApiErrorCategory): boolean =>
  category === "network" || category === "timeout" || category === "http_5xx";

/** Production keeps a generous budget, since a real query may legitimately be
 * slow. Development fails fast instead: when the API is simply not running,
 * undici's own 10s connect timeout would otherwise fire first and hold every
 * skeleton for ~10.5s before the error state could appear, once per poll. */
const DEFAULT_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 2_000 : 15_000;

export type FetchInit = {
  signal?: AbortSignal;
  revalidate?: number;
  /** Passed straight through. The route handlers use it to forward the original
   * client address, without which the backend rate-limits every viewer as one
   * client. */
  headers?: Record<string, string>;
};

async function fetchJson<A>(
  path: string,
  decode: (body: unknown) => A,
  init?: FetchInit,
): Promise<A> {
  const url = `${apiBase()}${path}`;
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  let res: Response;
  try {
    // `next.revalidate` engages Next's server data cache for immutable
    // resources; ignored in the browser.
    res = await fetch(url, {
      signal,
      ...(init?.headers ? { headers: init.headers } : {}),
      ...(init?.revalidate !== undefined ? { next: { revalidate: init.revalidate } } : {}),
    });
  } catch (cause) {
    const category: ApiErrorCategory = timeout.aborted ? "timeout" : "network";
    throw new ApiError(path, category, null, true, SAFE_MESSAGES[category], cause);
  }

  if (!res.ok) {
    const category = categorize(res.status);
    throw new ApiError(path, category, res.status, isRetryable(category), SAFE_MESSAGES[category]);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw new ApiError(
      path,
      "malformed_response",
      res.status,
      false,
      SAFE_MESSAGES.malformed_response,
      cause,
    );
  }

  try {
    return decode(body);
  } catch (cause) {
    throw new ApiError(
      path,
      "malformed_response",
      res.status,
      false,
      SAFE_MESSAGES.malformed_response,
      cause,
    );
  }
}

export const api = {
  // Never cached: an operations panel showing a stale tip age is worse than
  // one that is briefly unavailable.
  metrics: (init?: FetchInit) => fetchJson("/api/metrics", decodeMetrics, init),
  assets: (init?: FetchInit) => fetchJson("/api/assets", decodeAssets, init),
  asset: (policyId: string, assetName: string, init?: FetchInit) =>
    fetchJson(
      `/api/asset?policy_id=${encodeURIComponent(policyId)}&asset_name=${encodeURIComponent(assetName)}`,
      decodeAsset,
      init,
    ),
  block: (headerHash: string, init?: FetchInit) =>
    fetchJson(`/api/block?header_hash=${encodeURIComponent(headerHash)}`, decodeBlockResponse, {
      ...init,
      revalidate: 30,
    }),
  transaction: (txHash: string, init?: FetchInit) =>
    fetchJson(
      `/api/transaction?tx_hash=${encodeURIComponent(txHash)}`,
      decodeTransactionResponse,
      init,
    ),
  address: (address: string, init?: FetchInit) =>
    fetchJson(`/api/address?address=${encodeURIComponent(address)}`, decodeAddressResponse, init),
  blockByHeight: (height: number, init?: FetchInit) =>
    fetchJson(`/api/blocks/by-height/${height}`, decodeBlockByHeight, init),
  recentBlocks: (init?: FetchInit) => fetchJson("/api/blocks/recent", decodeRecentBlocks, init),
  totalBlocks: (init?: FetchInit) => fetchJson("/api/blocks/total", decodeTotal, init),
  blocksPage: (page: number, status?: string, init?: FetchInit) =>
    fetchJson(
      `/api/blocks/${page}${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      decodeBlocksPage,
      init,
    ),
  recentTxs: (init?: FetchInit) => fetchJson("/api/transactions/recent", decodeRecentTxs, init),
  totalTxs: (init?: FetchInit) => fetchJson("/api/transactions/total", decodeTotal, init),
  txsPage: (page: number, status?: string, init?: FetchInit) =>
    fetchJson(
      `/api/transactions/${page}${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      decodeTxsPage,
      init,
    ),
  depositsPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/deposits/${page}`, decodeDepositsPage, init),
  withdrawalsPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/withdrawals/${page}`, decodeWithdrawalsPage, init),
  forcedTxsPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/forced-transactions/${page}`, decodeForcedTxsPage, init),
  l1TxsPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/l1/transactions/${page}`, decodeL1TxsPage, init),
  l1Transaction: (txHash: string, init?: FetchInit) =>
    fetchJson(`/api/l1/transaction?txHash=${encodeURIComponent(txHash)}`, decodeL1Transaction, {
      ...init,
      revalidate: 30,
    }),
  l1Summary: (init?: FetchInit) => fetchJson("/api/l1/summary", decodeL1Summary, init),
};

/** What the indexer has found on Cardano itself. Independent of the Midgard
 * node: this data survives the node being offline, which is exactly when the
 * overview's ledger figures go quiet and a reader most needs something real.
 *
 * Decoded through the shared contract rather than by hand. The hand-written
 * version predated the L1 routes having a contract at all; that shortcut is
 * repaid now, and the app and the contract can no longer drift apart. */
export type {
  L1SourceIdentity,
  L1SummaryResponse as L1Summary,
  L1ValidatorIdentity,
} from "@midgard-explorer/contracts";

/** Cardano L1 transactions that touch a Midgard validator address.
 *
 * These are indexed from preprod by the explorer's own indexer, scanning from
 * block height 0, so this list is complete from the deployment's first
 * transaction rather than from whenever a local node happened to be running.
 * That is the difference between this page and /transactions, which reads the
 * Midgard node's own ledger.
 */
export type { L1TxRow } from "@midgard-explorer/contracts";
export type { L1TxsPageResponse as L1TxsPage } from "@midgard-explorer/contracts";
export type {
  L1Event,
  L1Redeemer,
  L1TransactionResponse,
  L1TxIo,
} from "@midgard-explorer/contracts";
