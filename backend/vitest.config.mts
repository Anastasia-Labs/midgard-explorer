import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mts"],
    setupFiles: ["test/setup-env.mts"],
    // Database-backed files read one Midgard database and several write to a
    // throwaway one. Running files in parallel lets one file's fixture reach
    // another's assertions, producing failures that depend on worker timing.
    // One worker matches that isolation model.
    //
    // The setup file that provisioned the explorer's own test index went with
    // the indexer: nothing under test owns a database any more.
    fileParallelism: false,
  },
});
