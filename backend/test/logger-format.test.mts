import { Writable } from "node:stream";
import winston from "winston";
import { describe, expect, it } from "vitest";
import { logFormat } from "../src/logger.js";

/**
 * What the server log keeps of an error.
 *
 * The error handler passes the thrown value itself to `logger.error`. With no
 * `errors()` format, winston turns an Error into `{ level, timestamp }`, so
 * every 500 the server answered was logged with no message and no stack.
 */
const capture = () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const log = winston.createLogger({
    level: "info",
    format: logFormat(),
    transports: [new winston.transports.Stream({ stream })],
  });
  return { log, text: () => lines.join("") };
};

describe("the server log format", () => {
  it("keeps an error's message and stack", () => {
    const { log, text } = capture();
    log.error(new Error('column "operator_validity" does not exist'));
    expect(text()).toContain('column "operator_validity" does not exist');
    expect(text()).toMatch(/at .*logger-format\.test\.mts/);
  });

  it("masks the credentials in a connection URL", () => {
    const { log, text } = capture();
    log.error(new Error("connect failed: postgresql://explorer:s3cret@db.internal:5432/midgard"));
    log.info("reading postgres://reader:hunter2@replica:5432/midgard");
    expect(text()).not.toContain("s3cret");
    expect(text()).not.toContain("hunter2");
    expect(text()).toContain("postgresql://***:***@db.internal:5432/midgard");
  });

  it("leaves a plain message unchanged", () => {
    const { log, text } = capture();
    log.info("Backend running on port: 3101");
    expect(text()).toContain("Backend running on port: 3101");
  });
});
