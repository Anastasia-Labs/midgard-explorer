import type { z } from "zod";
import type { configSchema } from "./config";
/** Derived from the parser, never hand-written.
 *
 * This was a standalone type and the two drifted: `RESPONSE_CACHE_MAX_BYTES`
 * was declared here, consumed by the cache, and absent from the schema. The
 * `as Config` cast in config.ts made that compile, so the limit was undefined
 * at runtime and every comparison against it was false. */
export type Config = z.infer<typeof configSchema>;
