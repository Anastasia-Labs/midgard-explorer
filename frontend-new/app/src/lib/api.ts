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

const DEFAULT_TIMEOUT_MS = 15_000;

export type FetchInit = { signal?: AbortSignal; revalidate?: number };

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
  blocksPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/blocks/${page}`, decodeBlocksPage, init),
  recentTxs: (init?: FetchInit) => fetchJson("/api/transactions/recent", decodeRecentTxs, init),
  totalTxs: (init?: FetchInit) => fetchJson("/api/transactions/total", decodeTotal, init),
  txsPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/transactions/${page}`, decodeTxsPage, init),
  depositsPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/deposits/${page}`, decodeDepositsPage, init),
  withdrawalsPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/withdrawals/${page}`, decodeWithdrawalsPage, init),
  forcedTxsPage: (page: number, init?: FetchInit) =>
    fetchJson(`/api/forced-transactions/${page}`, decodeForcedTxsPage, init),
};
