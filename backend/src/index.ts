import { config } from "./config";
import { loadManifest } from "./indexer/manifest";
import { startServer } from "./server/server";

// An unusable manifest is a configuration failure, not a sync failure.
//
// The indexer attributes every row it writes to the deployment this file
// declares, so a malformed one produces rows nothing can query back. The sync
// loop catches its own read and returns, which leaves the process serving while
// indexing nothing, and configuration only checks that the path names a file.
// This is where the file is actually parsed, before anything starts.
if (config.L1_SYNC_ENABLED) {
  try {
    loadManifest(config.MIDGARD_MANIFEST_PATH);
  } catch (error) {
    process.stderr.write(
      `Invalid deployment manifest at ${config.MIDGARD_MANIFEST_PATH}:\n  ${String(error)}\n`,
    );
    process.exit(1);
  }
}

startServer();
