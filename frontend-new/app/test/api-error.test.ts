import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, categorize, isRetryable } from "../src/lib/api";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("categorize", () => {
  it.each([
    [400, "http_400"],
    [404, "http_404"],
    [422, "http_422"],
    [500, "http_5xx"],
    [503, "http_5xx"],
    [418, "http_other"],
  ] as const)("maps %i to %s", (status, expected) => {
    expect(categorize(status)).toBe(expected);
  });
});

describe("isRetryable", () => {
  it("retries transport and server faults", () => {
    expect(isRetryable("network")).toBe(true);
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("http_5xx")).toBe(true);
  });

  it("does not retry client faults or decode failures", () => {
    expect(isRetryable("http_400")).toBe(false);
    expect(isRetryable("http_404")).toBe(false);
    expect(isRetryable("http_422")).toBe(false);
    expect(isRetryable("malformed_response")).toBe(false);
  });
});

describe("ApiError", () => {
  it("keeps endpoint, category and status on the instance", () => {
    const e = new ApiError("/api/blocks/total", "http_5xx", 500, true, "safe");
    expect(e.name).toBe("ApiError");
    expect(e.endpoint).toBe("/api/blocks/total");
    expect(e.category).toBe("http_5xx");
    expect(e.status).toBe(500);
    expect(e.retryable).toBe(true);
    expect(e.message).toContain("500");
  });

  it("omits the status from the message when there is none", () => {
    const e = new ApiError("/api/x", "network", null, true, "safe");
    expect(e.message).toBe("/api/x: network");
  });
});

describe("api client error mapping", () => {
  it("raises a categorized ApiError on a 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(api.totalBlocks()).rejects.toMatchObject({
      name: "ApiError",
      category: "http_5xx",
      retryable: true,
    });
  });

  it("raises http_404 without marking it retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(api.totalBlocks()).rejects.toMatchObject({
      category: "http_404",
      retryable: false,
    });
  });

  it("raises malformed_response when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 200 })),
    );
    await expect(api.totalBlocks()).rejects.toMatchObject({
      category: "malformed_response",
    });
  });

  it("raises malformed_response when the payload fails schema decoding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ total: "not a number" })),
    );
    await expect(api.totalBlocks()).rejects.toMatchObject({
      category: "malformed_response",
    });
  });

  it("raises network for a transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("connection refused");
      }),
    );
    await expect(api.totalBlocks()).rejects.toMatchObject({
      category: "network",
      retryable: true,
    });
  });

  it("never leaks the raw cause into the user-facing message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("ECONNREFUSED 127.0.0.1:3101");
      }),
    );
    await expect(api.totalBlocks()).rejects.toSatisfy(
      (e: ApiError) => !e.safeMessage.includes("ECONNREFUSED"),
    );
  });

  it("returns the decoded payload on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ total: 42 })),
    );
    await expect(api.totalBlocks()).resolves.toEqual({ total: 42 });
  });

  it("percent-encodes identifiers into the query string", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        seen.push(String(url));
        return jsonResponse({ rows: [], da: null, finalization: null });
      }),
    );
    await api.block("ab/cd?e");
    expect(seen[0]).toContain("header_hash=ab%2Fcd%3Fe");
  });
});
