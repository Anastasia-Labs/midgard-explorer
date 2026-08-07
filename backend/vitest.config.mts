import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mts"],
    setupFiles: ["test/setup-indexer-db.mts"],
  },
});
