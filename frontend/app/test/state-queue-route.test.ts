import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/state-queue/route";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

describe("the state queue relay", () => {
  /** The frontend deploys before the backend, so for a while it talks to a
   * backend that has no queue route. That is a source that cannot answer, not
   * a failure worth retrying every five seconds. */
  it("says unavailable when the backend has no queue route", async () => {
    answer(404, { error: "Not found." });
    const response = await GET(new Request("http://localhost/api/state-queue"));
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ unavailable: true });
  });

  it("says unavailable when the source cannot read the queue", async () => {
    answer(501, { unavailable: "unsupported_by_source", reason: "no node database" });
    expect((await GET(new Request("http://localhost/api/state-queue"))).status).toBe(501);
  });

  it("reports a failing backend as a failure the poll retries", async () => {
    answer(500, { error: "boom" });
    expect((await GET(new Request("http://localhost/api/state-queue"))).status).toBe(503);
  });
});
