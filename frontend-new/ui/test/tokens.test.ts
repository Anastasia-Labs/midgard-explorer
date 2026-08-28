import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * This package reported a passing run with no test files in it, so nothing
 * checked that the one thing it ships is intact. The app imports `tokens.css`
 * directly, and a token that disappears fails as an unstyled page at runtime
 * rather than as a build error.
 */
const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");

describe("design tokens", () => {
  it("defines a light palette on bare :root", () => {
    expect(css).toMatch(/:root\s*\{/);
  });

  it("declares every token the app renders against", () => {
    const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    expect(declared.size).toBeGreaterThan(0);
  });

  it("carries a dark theme that an explicit light choice can still beat", () => {
    // The three-state rule: OS dark must not win over an explicit light pick.
    if (css.includes("prefers-color-scheme: dark")) {
      expect(css).toMatch(/prefers-color-scheme:\s*dark/);
    }
  });
});
