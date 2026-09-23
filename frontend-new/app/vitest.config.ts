import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node by default. Starting jsdom cost more than every test's own run time,
    // and only the component tests render. Those opt in with a first line of
    // `// @vitest-environment jsdom`; a render test without it fails on
    // `document is not defined` rather than passing.
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
