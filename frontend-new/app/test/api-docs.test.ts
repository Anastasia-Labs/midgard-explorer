import { describe, expect, it } from "vitest";
import { openApiToGroups, type OpenApiDocument } from "../src/lib/apiDocs";

/**
 * This page used to render a hand-written list of endpoints that happened to
 * resemble the API. It now renders the document the backend generates from the
 * routes it mounts, so the only thing left to test here is the transformation:
 * given a document, does the page get the right groups, in the right order,
 * with the facts a reader needs.
 */

const document: OpenApiDocument = {
  openapi: "3.1.0",
  info: { title: "T", version: "1.0.0", description: "d" },
  tags: [{ name: "System" }, { name: "Blocks" }],
  paths: {
    "/healthz": {
      get: {
        tags: ["System"],
        summary: "Report backend health",
        parameters: [],
        responses: { "200": {} },
      },
    },
    "/api/blocks/{page}": {
      get: {
        tags: ["Blocks"],
        summary: "List blocks by page",
        parameters: [
          { name: "page", in: "path", required: true, description: "One-based page number." },
          { name: "status", in: "query", required: false, description: "Optional filter." },
        ],
        responses: { "200": {}, "429": {} },
      },
    },
  },
};

describe("openApiToGroups", () => {
  it("groups endpoints by their tag, in the document's tag order", () => {
    const groups = openApiToGroups(document);
    expect(groups.map((g) => g.name)).toEqual(["System", "Blocks"]);
  });

  it("keeps the path template a reader has to type", () => {
    const groups = openApiToGroups(document);
    expect(groups[1]!.endpoints[0]!.path).toBe("/api/blocks/{page}");
  });

  it("reads the rate limit from the response the server actually documents", () => {
    const groups = openApiToGroups(document);
    expect(groups[0]!.endpoints[0]!.rateLimited).toBe(false);
    expect(groups[1]!.endpoints[0]!.rateLimited).toBe(true);
  });

  it("names the parameters so a reader knows what to send", () => {
    const groups = openApiToGroups(document);
    expect(groups[1]!.endpoints[0]!.parameters).toEqual(["page: path", "status: query"]);
  });

  /** A tag with no operations should not render an empty section, and an
   * operation whose tag was never declared must still be reachable rather than
   * silently dropped. */
  it("drops empty groups and keeps undeclared tags", () => {
    const groups = openApiToGroups({
      ...document,
      tags: [{ name: "System" }, { name: "Unused" }],
      paths: {
        ...document.paths,
        "/api/mystery": {
          get: { tags: ["Ghost"], summary: "s", parameters: [], responses: {} },
        },
      },
    });
    expect(groups.map((g) => g.name)).toEqual(["System", "Blocks", "Ghost"]);
  });

  it("counts what it renders", () => {
    const groups = openApiToGroups(document);
    const total = groups.reduce((sum, group) => sum + group.endpoints.length, 0);
    expect(total).toBe(Object.keys(document.paths).length);
  });
});
