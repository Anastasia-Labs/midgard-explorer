import next from "eslint-config-next";

/**
 * The lint gate, as a flat config.
 *
 * `next lint` was removed in Next 16, so `pnpm lint` had been exiting with
 * "Invalid project directory provided, no such directory: .../lint" and linting
 * nothing at all. A gate that cannot run is not a gate, and the release notes
 * recorded it as passing.
 *
 * `scripts/` and the e2e fixture get Node globals explicitly. Those files run
 * under Node rather than in a browser, and without this they fail on
 * `AbortSignal`, `process` and friends.
 */
export default [
  ...next,
  {
    files: ["scripts/**/*.mjs", "e2e/fixtures/**/*.mjs"],
    languageOptions: {
      globals: {
        AbortSignal: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
];
