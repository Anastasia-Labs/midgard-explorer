import { config } from "./config";
import { loadManifest } from "./db/manifest";
import { startServer } from "./server/server";

// An unusable manifest is a configuration failure, and it is fatal here rather
// than at the first request.
//
// The manifest names the deployment every response is attributed to and the
// validators the Cardano pages describe. Configuration only checks that the
// path names a readable file; this is where the file is actually parsed. It
// used to run only when the indexer was enabled, so a process serving reads
// could start on a manifest nothing could parse and report every figure as
// belonging to an unknown deployment.
if (config.MIDGARD_MANIFEST_PATH !== undefined) {
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
