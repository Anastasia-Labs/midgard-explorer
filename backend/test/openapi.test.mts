import { describe, expect, it } from "vitest";
import { openApiDocument } from "../src/server/catalogue.js";

/**
 * What this file used to do was compare the document's paths against a literal
 * array written directly above the comparison. That passes whenever the two
 * copies agree with each other and says nothing about whether either agrees
 * with the routes the server actually mounts, which is the only question worth
 * asking. It has been removed rather than updated.
 *
 * Coverage of the catalogue is asserted in `catalogue.test.mts`, against the
 * same array the server registers from. What is left here is the document's own
 * contract: the envelope a consumer needs, and the facts the description has to
 * carry because no schema can express them.
 */

describe("OpenAPI document", () => {
  const document = openApiDocument();

  it("carries the envelope a generator or client needs", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.title).toBe("Midgard Explorer API");
    expect(document.info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(document.servers.length).toBeGreaterThan(0);
    expect(document.tags.length).toBeGreaterThan(0);
  });

  /** Every tag a path claims must be declared, or a documentation renderer
   * silently drops the group. */
  it("declares every tag its operations use", () => {
    const declared = new Set(document.tags.map((tag) => tag.name));
    for (const [path, item] of Object.entries(document.paths)) {
      for (const tag of item.get?.tags ?? []) {
        expect(declared.has(tag), `${path} uses undeclared tag ${tag}`).toBe(true);
      }
    }
  });

  it("gives every operation a unique operationId", () => {
    const ids = Object.values(document.paths).map((item) => item.get?.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** Ledger quantities exceed IEEE 754 integers, so the API returns them as
   * decimal strings. A consumer that parses them as numbers loses lovelace, and
   * no response schema in this document says so, therefore the description must. */
  it("warns that integer quantities are strings", () => {
    expect(document.info.description).toMatch(/decimal strings/i);
  });

  it("documents the retry contract wherever it answers 429", () => {
    for (const [path, item] of Object.entries(document.paths)) {
      const limited = item.get?.responses?.["429"] as
        | { headers?: Record<string, unknown> }
        | undefined;
      if (limited === undefined) continue;
      expect(limited.headers, `${path} answers 429 without Retry-After`).toHaveProperty(
        "Retry-After",
      );
    }
  });

  it("marks path parameters required and query parameters optional", () => {
    for (const [path, item] of Object.entries(document.paths)) {
      for (const parameter of item.get?.parameters ?? []) {
        expect(parameter.required, `${path} ${parameter.name}`).toBe(
          parameter.in === "path",
        );
      }
    }
  });
});
