/**
 * Turns the backend's OpenAPI document into what the reference page renders.
 *
 * This file used to be the API reference: a hand-written array of paths,
 * summaries and rate-limit flags that resembled the routes the server mounts
 * and drifted from them silently. It was one of four independent declarations
 * of the same surface. Now the backend generates its document from the
 * catalogue that registers the handlers, and this is only the adapter between
 * that document and the page.
 *
 * Nothing here knows the name of a single endpoint, which is the point.
 */

export type OpenApiOperation = {
  tags?: string[];
  summary?: string;
  parameters?: Array<{
    name: string;
    in: "path" | "query";
    required?: boolean;
    description?: string;
  }>;
  responses?: Record<string, unknown>;
};

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description: string };
  tags?: Array<{ name: string }>;
  paths: Record<string, { get?: OpenApiOperation }>;
};

export type ApiEndpoint = {
  path: string;
  summary: string;
  parameters: string[];
  rateLimited: boolean;
};

export type ApiGroup = { name: string; endpoints: ApiEndpoint[] };

const UNGROUPED = "Other";

export function openApiToGroups(document: OpenApiDocument): ApiGroup[] {
  const byGroup = new Map<string, ApiEndpoint[]>();

  for (const [path, item] of Object.entries(document.paths)) {
    const operation = item.get;
    if (operation === undefined) continue;

    const group = operation.tags?.[0] ?? UNGROUPED;
    const endpoint: ApiEndpoint = {
      path,
      summary: operation.summary ?? "",
      parameters: (operation.parameters ?? []).map((p) => `${p.name}: ${p.in}`),
      // The server documents 429 exactly where it enforces a limit, so the
      // response list is the honest source for this rather than a flag the
      // page keeps for itself.
      rateLimited: operation.responses?.["429"] !== undefined,
    };

    const existing = byGroup.get(group);
    if (existing === undefined) byGroup.set(group, [endpoint]);
    else existing.push(endpoint);
  }

  /* Declared tag order first, because it is the order the API author chose.
   * A tag with no operations is dropped rather than rendered as an empty
   * section, and an operation whose tag was never declared still appears, at
   * the end, rather than vanishing from the page. */
  const declared = (document.tags ?? []).map((tag) => tag.name);
  const ordered = [...declared, ...[...byGroup.keys()].filter((n) => !declared.includes(n))];

  return ordered
    .filter((name) => (byGroup.get(name)?.length ?? 0) > 0)
    .map((name) => ({ name, endpoints: byGroup.get(name)! }));
}

export function endpointCount(groups: readonly ApiGroup[]): number {
  return groups.reduce((sum, group) => sum + group.endpoints.length, 0);
}
