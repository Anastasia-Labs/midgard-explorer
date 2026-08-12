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
import {
  getL1SummaryRoute,
  getL1TransactionsPageRoute,
  getL1TransactionRoute,
  getL1BlockHeadersRoute,
  getL1DepositsRoute,
} from "./routes/l1";
import { buildOpenApiDocument, type OpenApiDocument } from "./openapi";

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
  handler: RequestHandler;
};

const hex64 = { type: "string", pattern: "^[0-9a-fA-F]{64}$" };
const hex56 = { type: "string", pattern: "^[0-9a-fA-F]{56}$" };
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
  } = {},
): Endpoint => ({
  method: "get",
  path,
  group,
  summary,
  parameters: options.parameters ?? [],
  notFound: options.notFound ?? false,
  rateLimited: options.rateLimited ?? false,
  handler,
});

const healthRoute: RequestHandler = (_req, res) => {
  res.json({ status: "ok", now: new Date().toISOString() });
};

/* Lazy on purpose: the document is generated from this array, so it cannot be
 * built while the array is still being defined. It is built per request, which
 * costs nothing measurable and keeps the two from drifting even in a session
 * where the catalogue is mutated by a test. */
const openApiRoute: RequestHandler = (_req, res) => {
  res.json(openApiDocument());
};

export const ENDPOINTS: readonly Endpoint[] = [
  endpoint("/healthz", "System", "Report backend health", healthRoute),
  endpoint("/api/openapi.json", "System", "Return this OpenAPI document", openApiRoute),

  endpoint("/api/metrics", "System", "Return explorer metrics", getMetricsRoute, {
    rateLimited: true,
  }),
  endpoint("/api/search", "Discovery", "Search indexed identifiers by prefix", getSearchRoute, {
    parameters: [
      query("q", "Hex identifier prefix; six or more characters returns matches."),
    ],
    rateLimited: true,
  }),

  endpoint("/api/assets", "Ledger", "List indexed assets", getAssetsRoute, {
    rateLimited: true,
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
  }),
  endpoint(
    "/api/address",
    "Ledger",
    "Return address balance, UTxOs, and history",
    getAddressRoute,
    {
      parameters: [query("address", "Midgard address in Bech32 form.")],
      notFound: true,
      rateLimited: true,
    },
  ),

  endpoint("/api/block", "Blocks", "Return one block by header hash", getBlockRoute, {
    parameters: [query("header_hash", "56-character block header hash.", hex56)],
    notFound: true,
    rateLimited: true,
  }),
  endpoint(
    "/api/blocks/by-height/:height",
    "Blocks",
    "Return one block by height",
    getBlockByHeightRoute,
    {
      parameters: [
        pathParam("height", "Non-negative Midgard block height.", {
          type: "integer",
          minimum: 0,
        }),
      ],
      notFound: true,
      rateLimited: true,
    },
  ),
  endpoint("/api/blocks/recent", "Blocks", "List recent blocks", getRecentBlocksRoute, {
    rateLimited: true,
  }),
  endpoint("/api/blocks/total", "Blocks", "Count blocks", getTotalBlocksRoute, {
    rateLimited: true,
  }),
  endpoint("/api/blocks/:page", "Blocks", "List blocks by page", getBlocksPageRoute, {
    parameters: [pageParam, query("status", "Optional finalization-status filter.")],
    rateLimited: true,
  }),

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
      parameters: [pageParam, query("status", "Optional transaction-status filter.")],
      rateLimited: true,
    },
  ),

  endpoint("/api/deposits/:page", "Bridge", "List Midgard deposits by page", getDepositsPageRoute, {
    parameters: [pageParam],
  }),
  endpoint(
    "/api/withdrawals/:page",
    "Bridge",
    "List Midgard withdrawals by page",
    getWithdrawalsPageRoute,
    { parameters: [pageParam] },
  ),
  endpoint(
    "/api/forced-transactions/:page",
    "Bridge",
    "List forced transactions by page",
    getForcedTransactionsPageRoute,
    { parameters: [pageParam] },
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
      parameters: [query("txHash", "64-character Cardano transaction hash.", hex64)],
      notFound: true,
      rateLimited: true,
    },
  ),
  endpoint(
    "/api/l1/block-headers",
    "Cardano L1",
    "List indexed Midgard block headers",
    getL1BlockHeadersRoute,
    { parameters: [query("limit", "Maximum rows; capped at 100.", limitSchema)] },
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
    { parameters: [query("limit", "Maximum rows; capped at 100.", limitSchema)] },
  ),
];

/** `/api/blocks/:page` in express is `/api/blocks/{page}` in OpenAPI. */
export function documentationPath(path: string): string {
  return path.replace(/:(\w+)/g, "{$1}");
}

export function registerCatalogue(app: Express): void {
  for (const route of ENDPOINTS) app.get(route.path, route.handler);
}

export function openApiDocument(): OpenApiDocument {
  return buildOpenApiDocument(ENDPOINTS);
}

/**
 * Where the limiter mounts, derived rather than listed.
 *
 * Express matches `app.use(prefix)` against a path prefix, so a mount is the
 * static head of a route: `/api/blocks/:page` is limited by mounting
 * `/api/blocks`. Descendants of another mount are dropped, or a request to
 * `/api/blocks/recent` would spend two budgets for one call.
 */
export function rateLimitedPaths(): string[] {
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
