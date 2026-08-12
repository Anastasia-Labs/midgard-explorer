/**
 * The OpenAPI document, generated from the endpoint catalogue.
 *
 * Nothing here declares a route. This file knows how to describe one: the
 * response vocabulary every route shares, the tag list, and the document
 * envelope. What exists comes from `catalogue.ts`, which is also what
 * registers the handlers, so the document cannot describe a route the server
 * does not serve or miss one it does.
 *
 * Response bodies are described as objects rather than as schemas. The shapes
 * a consumer decodes are declared once in `@midgard-explorer/contracts`, which
 * lives in the frontend workspace and is not reachable from this one. A second
 * hand-written copy here would be the same duplication this generation exists
 * to remove, so the document is honest about status codes and parameters and
 * silent about bodies until that packaging question is settled.
 */

export type OpenApiOperation = {
  tags: string[];
  summary: string;
  operationId: string;
  parameters: Array<{
    name: string;
    in: "path" | "query";
    required: boolean;
    description: string;
    schema: Record<string, unknown>;
  }>;
  responses: Record<string, unknown>;
};

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string }>;
  paths: Record<string, { get?: OpenApiOperation }>;
};

type CatalogueEntry = {
  path: string;
  group: string;
  summary: string;
  parameters: Array<{
    name: string;
    in: "path" | "query";
    description: string;
    schema: Record<string, unknown>;
  }>;
  notFound: boolean;
  rateLimited: boolean;
};

const response = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object" } } },
});

const rateLimitResponse = {
  ...response("Per-client request budget exhausted."),
  headers: {
    "Retry-After": {
      description: "Seconds until this route's request budget resets.",
      schema: { type: "integer", minimum: 1 },
    },
  },
};

const operationId = (group: string, summary: string) =>
  `${group.toLowerCase().replace(/\W+/g, "")}${summary.replace(/\W+/g, "")}`;

/** `/api/blocks/:page` in express is `/api/blocks/{page}` in OpenAPI. Kept
 * here as well as in the catalogue so this module can be read on its own; the
 * catalogue's copy is the one under test. */
const templated = (path: string) => path.replace(/:(\w+)/g, "{$1}");

export function buildOpenApiDocument(
  endpoints: readonly CatalogueEntry[],
): OpenApiDocument {
  const paths: Record<string, { get?: OpenApiOperation }> = {};

  for (const route of endpoints) {
    paths[templated(route.path)] = {
      get: {
        tags: [route.group],
        summary: route.summary,
        operationId: operationId(route.group, route.summary),
        parameters: route.parameters.map((parameter) => ({
          ...parameter,
          required: parameter.in === "path",
        })),
        responses: {
          "200": response("Successful response."),
          "400": response("Malformed identifier or parameter."),
          ...(route.notFound
            ? { "404": response("The requested record was not found.") }
            : {}),
          ...(route.rateLimited ? { "429": rateLimitResponse } : {}),
          "500": response("The server could not complete the request."),
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Midgard Explorer API",
      version: "1.0.0",
      description:
        "Read-only JSON access to the Midgard L2 ledger and the explorer's Cardano L1 index. Integer ledger quantities are returned as decimal strings when precision must be preserved. Expensive routes are rate limited per client and answer 429 with Retry-After.",
    },
    servers: [{ url: "/", description: "This explorer backend" }],
    tags: [...new Set(endpoints.map((route) => route.group))].map((name) => ({
      name,
    })),
    paths,
  };
}
