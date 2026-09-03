import type { Express, RequestHandler } from "express";
import {
  getBlockRoute,
  getBlockByHeightRoute,
  getRecentBlocksRoute,
  getTotalBlocksRoute,
  getBlocksPageRoute,
} from "./routes/block";
import { getAddressRoute } from "./routes/address";
import {
  getTotalTransactionsRoute,
  getTransactionRoute,
  getRecentTransactionsRoute,
  getTransactionsPageRoute,
} from "./routes/transaction";
import { getDepositsPageRoute } from "./routes/deposits";
import { getWithdrawalsPageRoute } from "./routes/withdrawals";
import { getForcedTransactionsPageRoute } from "./routes/forcedTransactions";
import { getMetricsRoute } from "./routes/metrics";
import { getAssetRoute, getAssetsRoute } from "./routes/asset";
import { getSearchRoute } from "./routes/search";
import { prisma } from "../db";
import { indexerPrisma } from "../indexer/db";
import { logger } from "../logger";
import { readinessRoute } from "./readiness";
import {
  probeIndexDatabase,
  probeIndexReconciled,
  probeDeploymentBinding,
  probeManifest,
  probeNodeDatabase,
} from "./probes";
import {
  getL1SummaryRoute,
  getL1TransactionsPageRoute,
  getL1TransactionRoute,
  getL1BlockHeadersRoute,
  getL1BlockHeaderRoute,
  getL1DepositsRoute,
  getL1ValidatorRoute,
} from "./routes/l1";
import { buildOpenApiDocument, type OpenApiDocument } from "./openapi";
import { cachePublicJson } from "./cache";
import { config } from "../config";
import { HASH28_HEX, HASH32_HEX } from "../utils";

/**
 * The one place a public route exists.
 *
 * This surface used to be declared four times: here as registration, again as
 * an OpenAPI document, again as a literal path list inside the document's own
 * test, and again as a hand-written list on the frontend's API reference page.
 * Adding a route took four edits, and the only drift any test could catch was
 * between the document and a copy of itself.
 *
 * Now registration, the document, the limiter's mount list and the reference
 * page all derive from this array. A route that is not here does not exist.
 *
 * Response schemas are deliberately absent. The shapes a consumer decodes live
 * in `@midgard-explorer/contracts`, which sits in the frontend workspace and
 * cannot be imported here. Declaring them a second time in this file would
 * recreate exactly the problem this catalogue removes, so the document
 * describes status codes and parameters and stays quiet about bodies until the
 * packaging question is answered.
 */

export type EndpointParameter = {
  name: string;
  in: "path" | "query";
  description: string;
  schema: Record<string, unknown>;
};

export type Endpoint = {
  method: "get";
  /** Express form, with `:param` segments. `documentationPath` converts it. */
  path: string;
  group: string;
  summary: string;
  parameters: EndpointParameter[];
  /** Whether this route answers 404 for a well-formed identifier that misses. */
  notFound: boolean;
  rateLimited: boolean;
  /** Shared-cache lifetime. Zero means do not cache this route. */
  cacheSeconds: number;
  handler: RequestHandler;
};

// Lowercase, matching what the routes actually accept. The document advertised
// a case-insensitive pattern while every hash route rejects uppercase, so a
// client that followed the schema got a 400 the schema said was valid. Cardano
// hashes are canonically lowercase and stored that way, so widening the routes
// instead would turn a clear rejection into a silent miss.
const hex64 = { type: "string", pattern: `^[0-9a-f]{${HASH32_HEX}}$` };
const hex56 = { type: "string", pattern: `^[0-9a-f]{${HASH28_HEX}}$` };
const pageSchema = { type: "integer", minimum: 1 };
const limitSchema = { type: "integer", minimum: 1, maximum: 100, default: 25 };

const query = (
  name: string,
  description: string,
  schema: Record<string, unknown> = { type: "string" },
): EndpointParameter => ({ name, in: "query", description, schema });

const pathParam = (
  name: string,
  description: string,
  schema: Record<string, unknown> = { type: "string" },
): EndpointParameter => ({ name, in: "path", description, schema });

const pageParam = pathParam("page", "One-based page number.", pageSchema);

const endpoint = (
  path: string,
  group: string,
  summary: string,
  handler: RequestHandler,
  options: {
    parameters?: EndpointParameter[];
    notFound?: boolean;
    rateLimited?: boolean;
    cacheSeconds?: number;
  } = {},
): Endpoint => ({
  method: "get",
  path,
  group,
  summary,
  parameters: options.parameters ?? [],
  notFound: options.notFound ?? false,
  // Every public API route is limited by default. Opting a future endpoint out
  // must therefore be a visible decision rather than an easy omission.
  rateLimited: options.rateLimited ?? path.startsWith("/api/"),
  // All API responses are public. Five seconds protects the node from bursts
  // while keeping mutable lifecycle state fresh; immutable/expensive routes
  // override this below.
  cacheSeconds: options.cacheSeconds ?? (path.startsWith("/api/") ? 5 : 0),
  handler,
});

const healthRoute: RequestHandler = (_req, res) => {
  res.json({ status: "ok", now: new Date().toISOString() });
};

const onFailure = (name: string, error: unknown) =>
  logger.error(`Readiness probe failed for ${name}: ${String(error)}`);

/**
 * L2 readiness: can this process serve the Midgard explorer?
 *
 * The node database and nothing else. Every L2 page reads it, and none of them
 * touch the Cardano index.
 *
 * This used to include the index, its reconciliation and the manifest, and
 * `/readyz` answers `checks.every(ok)`, so an index that had never reconciled
 * removed the whole instance from rotation, L2 routes included. That
 * contradicted the rule the explorer is built on: an L1 index behind the tip
 * degrades the Cardano surface and must never make an L2 page unavailable.
 *
 * `probeIndexDatabase` moved out with the rest. The L2 query surface does not
 * read the explorer index, so keeping it here would have moved the outage one
 * probe to the left rather than removing it.
 */
const readyRoute = readinessRoute(
  { "midgard-node": probeNodeDatabase },
  { onFailure },
);

/**
 * L1 readiness: can this process serve the Cardano surface?
 *
 * The index's shape, its migrations, a completed reconciliation, and the
 * manifest every indexed row is attributed to. Separate probes because they
 * fail for different reasons and an operator needs to read which: an index can
 * be shaped correctly and hold nothing any query can reach.
 *
 * A failure here takes the L1 pages out of rotation and leaves the L2 pages
 * serving, which is the whole point of the split.
 */
const readyL1Route = readinessRoute(
  {
    "midgard-node": probeNodeDatabase,
    "explorer-index": probeIndexDatabase,
    "index-reconciled": probeIndexReconciled,
    manifest: probeManifest,
    "deployment-binding": probeDeploymentBinding,
  },
  { onFailure },
);

/** Both capabilities, for a deployment gate that wants one call. */
const readyFullRoute = readinessRoute(
  {
    "midgard-node": probeNodeDatabase,
    "explorer-index": probeIndexDatabase,
    "index-reconciled": probeIndexReconciled,
    manifest: probeManifest,
    "deployment-binding": probeDeploymentBinding,
  },
  { onFailure },
);

/* Lazy on purpose: the document is generated from this array, so it cannot be
 * built while the array is still being defined. It is built per request, which
 * costs nothing measurable and keeps the two from drifting even in a session
 * where the catalogue is mutated by a test. */
const openApiRoute: RequestHandler = (_req, res) => {
  res.json(openApiDocument());
};

export const ENDPOINTS: readonly Endpoint[] = [
  endpoint("/healthz", "System", "Report that the process is alive", healthRoute),
  endpoint(
    "/readyz",
    "System",
    "Report whether the Midgard node database can serve a request",
    readyRoute,
  ),
  endpoint(
    "/readyz/l1",
    "System",
    "Report whether the Cardano index can serve a request",
    readyL1Route,
  ),
  endpoint(
    "/readyz/full",
    "System",
    "Report whether both capabilities can serve a request",
    readyFullRoute,
  ),
  endpoint(
    "/api/openapi.json",
    "System",
    "Return this OpenAPI document",
    openApiRoute,
    { cacheSeconds: 3_600 },
  ),

  endpoint(
    "/api/metrics",
    "System",
    "Return explorer metrics",
    getMetricsRoute,
    {
      rateLimited: true,
      cacheSeconds: 10,
    },
  ),
  endpoint(
    "/api/search",
    "Discovery",
    "Search indexed identifiers by prefix",
    getSearchRoute,
    {
      parameters: [
        query(
          "q",
          "Indexed identifier prefix (six or more hex characters) or a complete Bech32 address.",
        ),
      ],
      rateLimited: true,
    },
  ),

  endpoint("/api/assets", "Ledger", "List indexed assets", getAssetsRoute, {
    rateLimited: true,
    cacheSeconds: 10,
  }),
  endpoint("/api/asset", "Ledger", "Return one asset", getAssetRoute, {
    parameters: [
      query("policy_id", "56-character policy id.", hex56),
      query("asset_name", "Even-length hex asset name; empty means no name.", {
        type: "string",
        pattern: "^(?:[0-9a-fA-F]{2})*$",
        default: "",
      }),
    ],
    notFound: true,
    rateLimited: true,
    cacheSeconds: 10,
  }),
  endpoint(
    "/api/address",
    "Ledger",
    "Return address balance, UTxOs, and history",
    getAddressRoute,
    {
      parameters: [
        query("address", "Midgard address in Bech32 form."),
        query("page", "One-based address-history page.", {
          type: "integer",
          minimum: 1,
          default: 1,
        }),
      ],
      notFound: true,
      rateLimited: true,
    },
  ),

  endpoint(
    "/api/block",
    "Blocks",
    "Return one block by header hash",
    getBlockRoute,
    {
      parameters: [
        query("header_hash", "56-character block header hash.", hex56),
      ],
      notFound: true,
      rateLimited: true,
    },
  ),
  endpoint(
    "/api/blocks/by-height/:height",
    "Blocks",
    "Return one block by height",
    getBlockByHeightRoute,
    {
      parameters: [
        pathParam("height", "Non-negative legacy blocks-row identifier.", {
          type: "integer",
          minimum: 0,
        }),
      ],
      notFound: true,
      rateLimited: true,
    },
  ),
  endpoint(
    "/api/blocks/recent",
    "Blocks",
    "List recent blocks",
    getRecentBlocksRoute,
    {
      rateLimited: true,
    },
  ),
  endpoint("/api/blocks/total", "Blocks", "Count blocks", getTotalBlocksRoute, {
    rateLimited: true,
  }),
  endpoint(
    "/api/blocks/:page",
    "Blocks",
    "List blocks by page",
    getBlocksPageRoute,
    {
      parameters: [
        pageParam,
        query("status", "Optional finalization-status filter."),
      ],
      rateLimited: true,
    },
  ),

  endpoint(
    "/api/transaction",
    "Transactions",
    "Return one Midgard transaction",
    getTransactionRoute,
    {
      parameters: [query("tx_hash", "64-character transaction hash.", hex64)],
      notFound: true,
      rateLimited: true,
    },
  ),
  endpoint(
    "/api/transactions/recent",
    "Transactions",
    "List recent transactions",
    getRecentTransactionsRoute,
    { rateLimited: true },
  ),
  endpoint(
    "/api/transactions/total",
    "Transactions",
    "Count transactions",
    getTotalTransactionsRoute,
    { rateLimited: true },
  ),
  endpoint(
    "/api/transactions/:page",
    "Transactions",
    "List transactions by page",
    getTransactionsPageRoute,
    {
      parameters: [
        pageParam,
        query("status", "Optional transaction-status filter."),
      ],
      rateLimited: true,
    },
  ),

  endpoint(
    "/api/deposits/:page",
    "Bridge",
    "List Midgard deposits by page",
    getDepositsPageRoute,
    {
      parameters: [pageParam, query("id", "Optional exact deposit event id.")],
    },
  ),
  endpoint(
    "/api/withdrawals/:page",
    "Bridge",
    "List Midgard withdrawals by page",
    getWithdrawalsPageRoute,
    { parameters: [pageParam, query("id", "Optional exact withdrawal event id.")] },
  ),
  endpoint(
    "/api/forced-transactions/:page",
    "Bridge",
    "List forced transactions by page",
    getForcedTransactionsPageRoute,
    { parameters: [pageParam, query("id", "Optional exact forced-transaction order id.")] },
  ),

  endpoint(
    "/api/l1/summary",
    "Cardano L1",
    "Return index and deployment summary",
    getL1SummaryRoute,
  ),
  endpoint(
    "/api/l1/transaction",
    "Cardano L1",
    "Return one Cardano transaction touching Midgard",
    getL1TransactionRoute,
    {
      parameters: [
        query("txHash", "64-character Cardano transaction hash.", hex64),
      ],
      notFound: true,
      rateLimited: true,
    },
  ),
  endpoint(
    "/api/l1/block-headers",
    "Cardano L1",
    "List indexed Midgard block headers",
    getL1BlockHeadersRoute,
    {
      parameters: [query("limit", "Maximum rows; capped at 100.", limitSchema)],
    },
  ),
  endpoint(
    "/api/l1/block-header",
    "Cardano L1",
    "Return one Midgard header observed on Cardano",
    getL1BlockHeaderRoute,
    {
      parameters: [query("headerHash", "56-character Midgard header hash.", hex56)],
      notFound: true,
      cacheSeconds: 30,
    },
  ),
  endpoint(
    "/api/l1/validator",
    "Cardano L1",
    "Return indexed evidence for one Midgard validator",
    getL1ValidatorRoute,
    {
      parameters: [query("scriptHash", "56-character validator script hash.", hex56)],
      notFound: true,
      cacheSeconds: 30,
    },
  ),
  endpoint(
    "/api/l1/transactions/:page",
    "Cardano L1",
    "List Cardano transactions by page",
    getL1TransactionsPageRoute,
    { parameters: [pageParam] },
  ),
  endpoint(
    "/api/l1/deposits",
    "Cardano L1",
    "List Cardano deposit events",
    getL1DepositsRoute,
    {
      parameters: [query("limit", "Maximum rows; capped at 100.", limitSchema)],
    },
  ),
];

/** `/api/blocks/:page` in express is `/api/blocks/{page}` in OpenAPI. */
export function documentationPath(path: string): string {
  return path.replace(/:(\w+)/g, "{$1}");
}

export function registerCatalogue(app: Express): void {
  for (const route of ENDPOINTS) {
    app.get(
      route.path,
      cachePublicJson(
        route.cacheSeconds * 1_000,
        config.RESPONSE_CACHE_MAX_ENTRIES,
        config.RESPONSE_CACHE_MAX_BYTES,
      ),
      route.handler,
    );
  }
}

export function openApiDocument(): OpenApiDocument {
  return buildOpenApiDocument(ENDPOINTS);
}

/**
 * Where the limiter mounts, derived rather than listed.
 *
 * Every `/api` route is limited, so one `/api` mount provides a real aggregate
 * budget. A separate limiter per endpoint would let a crawler multiply its
 * allowance by walking every route family.
 */
export function rateLimitedPaths(): string[] {
  const publicApi = ENDPOINTS.filter((route) => route.path.startsWith("/api/"));
  if (publicApi.length > 0 && publicApi.every((route) => route.rateLimited)) {
    return ["/api"];
  }

  // Retained for a future mixed public/private catalogue: never put an
  // unlimited route underneath a broad limiter and then document it as free.
  const prefixes = new Set(
    ENDPOINTS.filter((route) => route.rateLimited).map((route) => {
      const segments = route.path.split("/");
      const dynamic = segments.findIndex((segment) => segment.startsWith(":"));
      return (dynamic === -1 ? segments : segments.slice(0, dynamic)).join("/");
    }),
  );

  return [...prefixes].filter(
    (candidate) =>
      ![...prefixes].some(
        (other) => other !== candidate && candidate.startsWith(`${other}/`),
      ),
  );
}
