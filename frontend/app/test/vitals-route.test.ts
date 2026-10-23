import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/vitals/route";

afterEach(() => vi.unstubAllGlobals());

describe("vitals proxy request limits", () => {
  it("counts UTF-8 bytes rather than characters", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await POST(
      new Request("http://localhost/api/vitals", {
        method: "POST",
        body: "é".repeat(600),
      }),
    );
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("cancels an oversized stream before consuming the remaining body", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    let reads = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads += 1;
          if (reads <= 10) controller.enqueue(new Uint8Array(600));
          else controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const request = new Request("http://localhost/api/vitals", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect((await POST(request)).status).toBe(413);
    expect(reads).toBe(2);
    expect(cancel).toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("preserves the viewer identity using the shared forwarding helper", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", upstream);
    const body = JSON.stringify({
      name: "LCP",
      value: 5,
      routeClass: "overview",
      deviceClass: "mobile",
    });
    const response = await POST(
      new Request("http://localhost/api/vitals", {
        method: "POST",
        body,
        headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9" },
      }),
    );
    expect(response.status).toBe(204);
    expect(upstream.mock.calls[0]?.[1].headers["x-forwarded-for"]).toBe("203.0.113.9");
  });
});
