import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONFIG_KEYS } from "../src/config.js";

/**
 * A setting that exists only in the schema is undiscoverable: an operator reads
 * `.env.example`, not `config.ts`, and finds out about the new variable when
 * the boot refuses. This keeps the two in step in the one direction that
 * matters, and says nothing about values.
 */

const example = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8",
);

const documented = new Set(
  example
    .split("\n")
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1])
    .filter((name): name is string => Boolean(name)),
);

describe(".env.example", () => {
  it("documents every setting the backend reads", () => {
    const missing = CONFIG_KEYS.filter((key) => !documented.has(key));
    expect(missing).toEqual([]);
  });
});
