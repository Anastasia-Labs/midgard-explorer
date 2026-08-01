import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Node globals for the plain-JS files that run outside the bundler
 * (the fixture backend and build scripts). */
const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  fetch: "readonly",
};

export default tseslint.config(
  {
    ignores: ["**/.next/**", "**/node_modules/**", "**/test-results/**", "**/playwright-report/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: nodeGlobals },
  },
  {
    // Capture scripts run in Node but pass callbacks to `page.evaluate`, whose
    // body is serialized and executed inside the browser. Those references are
    // correct, and the only place in this repo where one file legitimately
    // spans both environments.
    files: ["app/scripts/**/*.mjs"],
    languageOptions: { globals: { ...nodeGlobals, document: "readonly" } },
  },
  {
    // Fixtures and tests build branded shapes directly rather than decoding.
    files: ["app/test/**", "app/e2e/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
