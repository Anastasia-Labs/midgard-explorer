import { afterEach, describe, expect, it, vi } from "vitest";
import { readLimitedText } from "../src/lib/requestBody";

afterEach(() => vi.useRealTimers());

describe("bounded request reader", () => {
  it("accepts exactly the byte limit even across UTF-8 chunk boundaries", async () => {
    const bytes = new TextEncoder().encode("é".repeat(512));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1));
        controller.close();
      },
    });
    const request = new Request("http://localhost/", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(await readLimitedText(request, 1024, 3000)).toBe("é".repeat(512));
  });
  it("cancels a stalled stream at the request deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const request = new Request("http://localhost/", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    const result = expect(readLimitedText(request, 1024, 3000)).rejects.toMatchObject({
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("turns a failed incoming stream into a client error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("broken"));
      },
    });
    const request = new Request("http://localhost/", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(readLimitedText(request, 1024, 3000)).rejects.toMatchObject({ status: 400 });
  });
});
