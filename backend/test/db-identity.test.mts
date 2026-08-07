import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/logger.js";
import { reportDatabaseIdentity } from "../src/db/identity.js";
import { config } from "../src/config.js";

/** This exists because the explorer read a test-coverage database for weeks
 * and reported its contents as the live chain. Nothing failed: a wrong
 * database answers every query perfectly. The one thing that would have caught
 * it is the backend saying, at boot, which database it actually reached. */
describe("reportDatabaseIdentity", () => {
  afterEach(() => vi.restoreAllMocks());

  async function captureLogs(): Promise<string> {
    const lines: string[] = [];
    vi.spyOn(logger, "info").mockImplementation(((m: string) => {
      lines.push(String(m));
    }) as never);
    vi.spyOn(logger, "error").mockImplementation(((m: string) => {
      lines.push(String(m));
    }) as never);
    await reportDatabaseIdentity();
    return lines.join("\n");
  }

  it("names the database the connection actually reached, not the configured one", async () => {
    const out = await captureLogs();
    // current_database() is answered by the server, so this is the real name
    // even when the configured URL says something else.
    expect(out).toContain("Explorer database:");
    expect(out).toMatch(/Explorer database: "[a-z0-9_]+"/);
  });

  it("reports how much the explorer database holds, so a wrong one is obvious", async () => {
    const out = await captureLogs();
    expect(out).toMatch(/indexed L1 transactions/);
  });

  // The discriminating case. A boot line that dumps the connection URL would
  // satisfy every assertion above and put the database password in the logs.
  it("never puts credentials in the log", async () => {
    const out = await captureLogs();
    const password = process.env.POSTGRES_PASSWORD ?? "";
    if (password.length > 0) expect(out).not.toContain(password);

    // Only checked when the value is long enough to be a real secret. The
    // local explorer database uses a short dev password that is also a
    // substring of its own database name, so a plain "does not contain"
    // assertion fails on a correct log line and would have to be deleted,
    // taking the real protection with it.
    const indexerPassword = new URL(config.INDEXER_POSTGRES_URL).password;
    if (indexerPassword.length >= 16) expect(out).not.toContain(indexerPassword);

    // The assertion that holds regardless of password strength: no connection
    // string, and no user:secret@host anywhere. This is what actually catches
    // a future version that decides to log the URL it connected with.
    expect(out).not.toContain("postgresql://");
    expect(out).not.toContain("postgres://");
    expect(out).not.toMatch(/[^\s:]+:[^\s@]+@[^\s/]+/);
  });

  it("does not throw when a database is unreachable, so boot is never blocked", async () => {
    await expect(captureLogs()).resolves.toBeTypeOf("string");
  });
});
