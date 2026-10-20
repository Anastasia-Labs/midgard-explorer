import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { assertDisposableServer, applicationServer } from "./helpers/testTarget.mjs";
import { serverUrl } from "./helpers/throwawayDb.mjs";

/**
 * The suite's database is never the application's.
 *
 * `backend/.env` holds the application's credentials: on a developer machine
 * they name the live Midgard node's PostgreSQL. The suite loaded that file, so
 * a local run read the live node database, and the throwaway harness, which
 * defaulted to `POSTGRES_URL`, would have created databases on that server
 * had a database test been enabled. The suite now takes its server
 * only from `TEST_POSTGRES_URL` (or the benchmark's own URL), never loads
 * `.env`, and refuses a target on the same server the application's `.env`
 * names before it connects.
 */

const envFile = (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), "app-env-"));
  const path = join(dir, ".env");
  writeFileSync(path, body);
  return path;
};

/** The shape of the real file: discrete settings and an expanded URL. */
const APP_ENV = [
  "POSTGRES_HOST=localhost",
  "POSTGRES_PORT=5433",
  "POSTGRES_USER=node",
  "POSTGRES_PASSWORD=secret",
  "POSTGRES_DB=midgard",
  "POSTGRES_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public",
].join("\n");

describe("the application's server, read from its .env", () => {
  it("is the host and port its POSTGRES_URL expands to", () => {
    expect(applicationServer(envFile(APP_ENV))).toEqual({ host: "127.0.0.1", port: 5433 });
  });

  it("is nothing when there is no .env, as in CI", () => {
    expect(applicationServer(join(tmpdir(), "no-such-dir", ".env"))).toBeNull();
  });
});

describe("a disposable test server", () => {
  const app = envFile(APP_ENV);

  it("is refused when it is the application's server, under any loopback name", () => {
    for (const url of [
      "postgresql://u:p@127.0.0.1:5433/postgres",
      "postgresql://u:p@localhost:5433/other",
      "postgresql://u:p@[::1]:5433/postgres",
    ]) {
      expect(() => assertDisposableServer(url, app), url).toThrow(/refusing/);
    }
  });

  it("is accepted on another port, and the error never carries the password", () => {
    expect(() => assertDisposableServer("postgresql://u:p@127.0.0.1:55432/postgres", app)).not.toThrow();
    try {
      assertDisposableServer("postgresql://u:hunter2@127.0.0.1:5433/postgres", app);
    } catch (err) {
      expect(String(err)).not.toContain("hunter2");
    }
  });
});

describe("the throwaway harness", () => {
  const saved = { test: process.env.TEST_POSTGRES_URL, app: process.env.POSTGRES_URL };
  afterEach(() => {
    process.env.TEST_POSTGRES_URL = saved.test;
    process.env.POSTGRES_URL = saved.app;
    if (saved.test === undefined) delete process.env.TEST_POSTGRES_URL;
  });

  it("takes no server from POSTGRES_URL", () => {
    delete process.env.TEST_POSTGRES_URL;
    process.env.POSTGRES_URL = "postgresql://u:p@127.0.0.1:55432/midgard_node_ci";
    expect(() => serverUrl()).toThrow(/TEST_POSTGRES_URL/);
  });
});

describe("the suite's own configuration", () => {
  it("does not come from the application's .env", () => {
    expect(process.env.EXPLORER_DOTENV).toBe("off");
    const app = applicationServer(new URL("../.env", import.meta.url).pathname);
    if (app === null) return;
    const used = new URL(config.POSTGRES_URL!);
    expect(`${used.hostname}:${used.port}`).not.toBe(`${app.host}:${app.port}`);
  });
});
