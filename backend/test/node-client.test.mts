import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeClient } from "../src/public/nodeClient.js";

afterEach(() => vi.restoreAllMocks());

describe("public node reads", () => {
  it("removes a timed-out waiter so the next request gets the released slot", async () => {
    const controllers: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(new Response(JSON.stringify({ deploymentMarker: { manifestId: "next" } })));
    const client = new NodeClient("http://node.invalid", { maxInFlight: 1, fetch: fetcher });
    const first = client.protocolInfo();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const expired = client.protocolInfo();
    const refused = expect(expired).rejects.toMatchObject({ reason: "unavailable" });
    controllers[1]!.abort();
    await refused;
    const next = client.protocolInfo();
    finish(new Response(JSON.stringify({ deploymentMarker: { manifestId: "first" } })));
    await expect(first).resolves.toEqual({ manifestId: "first" });
    await expect(next).resolves.toEqual({ manifestId: "next" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cancels an error body before returning the node's retry response", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: 429, headers: { "retry-after": "7" },
    });
    const client = new NodeClient("http://node.invalid", {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    });
    await expect(client.protocolInfo()).rejects.toMatchObject({ reason: "rate_limited", retryAfterSeconds: 7 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("refuses transaction data from a different deployment even without a readiness probe", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ deploymentMarker: { manifestId: "other" } })),
    );
    const client = new NodeClient("http://node.invalid", {
      deploymentFingerprint: "expected", fetch: fetcher,
    });
    await expect(client.txStatus("ab".repeat(32))).rejects.toMatchObject({ reason: "invalid" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe("http://node.invalid/protocol-info");
  });
});
