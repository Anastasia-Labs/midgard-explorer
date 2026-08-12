import { z } from "zod";
import { Config } from "./types";
import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";

// expand() resolves ${VAR} references in .env (e.g. POSTGRES_URL is built from the
// discrete POSTGRES_* vars). Prisma 6's engine did this internally; the v7 driver
// adapter reads process.env directly, so we own the expansion here.
expand(dotenv.config());

/** A required setting. An empty string counts as missing: `FOO=` in a .env file
 * is the most common way a setting goes absent, and it used to pass straight
 * through the `as string` cast this schema replaces. */
const required = z.string().min(1);

/** A port or a positive count. `Number("")` is 0 and `Number(undefined)` is
 * NaN, and both used to sail through as a port number. */
const positive = z.coerce.number().int().positive();

/** Optional, with an empty value read as absent. `FOO=` and no `FOO` line at
 * all mean the same thing to an operator, so they must mean the same thing
 * here. */
const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const schema = z.object({
  BACKEND_PORT: positive,
  // min(1) matters: `CORS_ORIGIN=` in a .env used to pass as the empty string,
  // which is not "unset" and never reaches the default. It sailed past the
  // production wildcard guard and emitted an empty Access-Control-Allow-Origin,
  // with nothing anywhere saying so.
  CORS_ORIGIN: required.default("*"),
  POSTGRES_URL: required,
  LOG_LOCATION: required,
  // Optional because the explorer reads the node's Postgres directly and no
  // code path calls the node over HTTP today. Kept and still validated so a
  // future caller gets a real host and port rather than undefined and NaN,
  // which is what these silently were before this schema existed.
  //
  // `blank` treats `NODE_RPC_HOST=` as absent rather than failing. An empty
  // value counts as missing everywhere else in this schema, and an optional
  // setting that refuses an empty line would contradict that.
  NODE_RPC_HOST: blank(required),
  NODE_RPC_PORT: blank(positive),
  POSTGRES_HOST: required,
  POSTGRES_PORT: positive,
  POSTGRES_USER: required,
  POSTGRES_PASSWORD: required,
  POSTGRES_DB: required,
  RECENT_BLOCKS_LIMIT: positive,
  RECENT_TRANSACTIONS_LIMIT: positive,
  TRANSACTIONS_PER_PAGE: positive,
  BLOCKS_PER_PAGE: positive,
  INDEXER_POSTGRES_URL: required,
  KOIOS_BASE_URL: required,
  MIDGARD_MANIFEST_PATH: required,
  L1_SYNC_INTERVAL_MS: positive,
  // Zero is meaningful here: it means every pass is a full rescan from genesis.
  L1_REORG_LOOKBACK_BLOCKS: z.coerce.number().int().nonnegative(),
});

/** Takes the environment rather than reading it, so the rules can be tested
 * without mutating the real process. */
export function parseConfig(
  env: NodeJS.ProcessEnv | Record<string, unknown>,
): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Every bad variable at once. Fixing configuration one restart per variable
    // is how a five minute problem becomes an hour. Names only, never values:
    // several of these are credentials.
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid backend configuration:\n  ${detail}`);
  }
  return parsed.data as Config;
}

export const config: Config = parseConfig(process.env);
