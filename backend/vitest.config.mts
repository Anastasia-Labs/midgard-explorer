import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mts"],
    setupFiles: ["test/setup-indexer-db.mts"],
    // Database-backed files share one guarded `_test` database and reset its
    // L1 tables between cases. Running files in parallel lets one file delete
    // another file's parent rows, producing foreign-key and unique-key failures
    // that depend on worker timing. One worker matches that isolation model.
    fileParallelism: false,
  },
});
