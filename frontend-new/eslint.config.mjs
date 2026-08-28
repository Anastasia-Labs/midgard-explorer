import js from "@eslint/js";
import react from "eslint-plugin-react";
import tseslint from "typescript-eslint";

/** Node globals for the plain-JS files that run outside the bundler
 * (the fixture backend and build scripts). */
const nodeGlobals = {
  AbortSignal: "readonly",
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
    // An identifier deliberately named `_something` is a declaration of intent:
    // the value is being received and discarded. `ignoreRestSiblings` covers
    // the omit-by-destructuring idiom, where a property is named only so the
    // rest object excludes it.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
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
    // Playwright decides which fixtures to build by reading the destructuring
    // pattern of the first parameter, so a hook that wants only the second
    // parameter, `testInfo`, has to destructure nothing from the first. That
    // empty pattern is the API, not an oversight.
    files: ["app/test/**", "app/e2e/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty-pattern": "off",
    },
  },
  {
    // `title=` on a DOM element hides its text behind a mouse hover:
    // unreachable by touch, and announced inconsistently by screen readers.
    // Use `InfoTip`, an `sr-only` label, or a column `headerNote` instead.
    // This rule targets DOM elements only, so component props named `title`
    // (PageHeader, Panel, Callout, EmptyState) are unaffected.
    files: ["app/src/**/*.tsx", "ui/src/**/*.tsx"],
    plugins: { react },
    rules: {
      "react/forbid-dom-props": [
        "error",
        {
          forbid: [
            {
              propName: "title",
              message:
                "title= is hover-only. Use InfoTip, an sr-only label, or a column headerNote.",
            },
          ],
        },
      ],
    },
  },
);
