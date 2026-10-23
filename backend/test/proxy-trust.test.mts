import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { resetRateLimits } from "../src/server/rateLimit.js";
import { createApp } from "../src/server/server.js";

/**
 * Client identity as the real server resolves it, over a real socket.
 *
 * `hardening.test.mts` exercises the limiter with a hand-built request whose
 * `ip` is whatever the test says. That never runs Express's own resolution of
 * `req.ip`, which goes through `proxy-addr` and the `trust proxy` setting. This
 * file does: each case starts the app, sends requests from 127.0.0.1 with a
 * forwarded header, and reads the limiter's verdict.
 *
 * With a budget of one request per client, a second request answered 429 means
 * both requests were counted as the same client, and 200 means they were not.
 */

type Mutable = {
  TRUSTED_PROXY_MODE: "none" | "single-edge";
  TRUSTED_PROXY_PEERS: string[];
  API_RATE_LIMIT_MAX: number;
};
const mutable = config as unknown as Mutable;
const saved = { ...mutable };

let server: Server | undefined;

afterEach(async () => {
  Object.assign(mutable, {
    TRUSTED_PROXY_MODE: saved.TRUSTED_PROXY_MODE,
    TRUSTED_PROXY_PEERS: saved.TRUSTED_PROXY_PEERS,
    API_RATE_LIMIT_MAX: saved.API_RATE_LIMIT_MAX,
  });
  resetRateLimits();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function start(
  mode: Mutable["TRUSTED_PROXY_MODE"],
  peers: string[],
  host: "127.0.0.1" | "::",
): Promise<string> {
  Object.assign(mutable, {
    TRUSTED_PROXY_MODE: mode,
    TRUSTED_PROXY_PEERS: peers,
    API_RATE_LIMIT_MAX: 1,
  });
  const app = createApp();
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, host, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  // Always dialled over IPv4. On a "::" listener the peer then arrives in the
  // IPv4-mapped form, `::ffff:127.0.0.1`.
  return `http://127.0.0.1:${port}/api/openapi.json`;
}

const statusFor = async (url: string, forwardedFor: string) =>
  (await fetch(url, { headers: { "x-forwarded-for": forwardedFor } })).status;

describe("client identity over a real socket", () => {
  it("leaves Express's own proxy trust off", () => {
    expect(createApp().get("trust proxy")).toBe(false);
  });

  it("ignores a forwarded header when no edge is trusted, even from a listed peer", async () => {
    const url = await start("none", ["127.0.0.1"], "127.0.0.1");
    expect(await statusFor(url, "203.0.113.7")).toBe(200);
    expect(await statusFor(url, "203.0.113.8")).toBe(429);
  });

  it("believes the named edge", async () => {
    const url = await start("single-edge", ["127.0.0.1"], "127.0.0.1");
    expect(await statusFor(url, "203.0.113.7")).toBe(200);
    expect(await statusFor(url, "203.0.113.8")).toBe(200);
  });

  it("ignores a forwarded header from a peer outside the named edge", async () => {
    const url = await start("single-edge", ["10.0.0.0/8"], "127.0.0.1");
    expect(await statusFor(url, "203.0.113.7")).toBe(200);
    expect(await statusFor(url, "203.0.113.8")).toBe(429);
  });

  it("recognises the named edge when its address arrives IPv4-mapped", async () => {
    const url = await start("single-edge", ["127.0.0.1"], "::");
    expect(await statusFor(url, "203.0.113.7")).toBe(200);
    expect(await statusFor(url, "203.0.113.8")).toBe(200);
  });

  it("does not trust an IPv4-mapped CIDR entry it cannot parse", async () => {
    // The advisory's trigger is a trust subnet written in IPv4-mapped form. Our
    // matcher reads IPv4 CIDRs only, so such an entry must trust nobody.
    const url = await start("single-edge", ["::ffff:127.0.0.1/104"], "::");
    expect(await statusFor(url, "203.0.113.7")).toBe(200);
    expect(await statusFor(url, "203.0.113.8")).toBe(429);
  });

  it("takes only the rightmost entry the edge wrote", async () => {
    const url = await start("single-edge", ["127.0.0.1"], "127.0.0.1");
    expect(await statusFor(url, "1.1.1.1, 203.0.113.7")).toBe(200);
    expect(await statusFor(url, "2.2.2.2, 203.0.113.7")).toBe(429);
  });
});
