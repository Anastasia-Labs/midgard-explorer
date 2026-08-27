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

const boolean = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

/** Optional, with an empty value read as absent. `FOO=` and no `FOO` line at
 * all mean the same thing to an operator, so they must mean the same thing
 * here. */
const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const shape = {
  BACKEND_PORT: positive,
  // min(1) matters: `CORS_ORIGIN=` in a .env used to pass as the empty string,
  // which is not "unset" and never reaches the default. It sailed past the
  // production wildcard guard and emitted an empty Access-Control-Allow-Origin,
  // with nothing anywhere saying so.
  CORS_ORIGIN: required.default("*"),
  POSTGRES_URL: required,
  // Optional locally for backwards compatibility. Production can make the
  // replica mandatory with REQUIRE_MIDGARD_READ_REPLICA=true.
  MIDGARD_READ_REPLICA_URL: blank(required),
  REQUIRE_MIDGARD_READ_REPLICA: boolean.default(false),
  NODE_DB_POOL_MAX: positive.default(8),
  INDEXER_DB_POOL_MAX: positive.default(5),
  DB_CONNECTION_TIMEOUT_MS: positive.default(5_000),
  DB_IDLE_TIMEOUT_MS: positive.default(30_000),
  DB_STATEMENT_TIMEOUT_MS: positive.default(10_000),
  RESPONSE_CACHE_MAX_ENTRIES: positive.default(1_000),
  // Declared in the Config type and passed into the cache, but never parsed:
  // the `as Config` cast below hid the mismatch, so the value was `undefined`
  // and `cachedBytes > undefined` is always false. The byte ceiling was off in
  // every deployment while the code read as though it were on.
  RESPONSE_CACHE_MAX_BYTES: positive.default(64 * 1024 * 1024),
  // How many proxy hops in front of this process are trusted to state the
  // client address. 0, the default, means none: the socket peer is the
  // identity and `x-forwarded-for` is ignored whoever sent it. A private peer
  // is not evidence of a trusted hop, which is what made the limiter evadable
  // by any client willing to send its own header.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),
  API_RATE_LIMIT_MAX: positive.default(120),
  API_RATE_LIMIT_WINDOW_MS: positive.default(60_000),
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
  // The indexing loop. Default true so a single-process deployment behaves as
  // it always has; a second API instance sets it false and serves reads only,
  // because two loops against one index duplicate every Koios request and
  // race each other's writes.
  L1_SYNC_ENABLED: boolean.default(true),
  // Zero is meaningful here: it means every pass is a full rescan from genesis.
  L1_REORG_LOOKBACK_BLOCKS: z.coerce.number().int().nonnegative(),
} as const;

/** The names the backend reads, exported so `.env.example` can be checked
 * against them rather than kept in step by memory. */
export const CONFIG_KEYS = Object.keys(shape);

export const configSchema = z
  .object(shape)
  .superRefine((value, ctx) => {
    if (
      value.REQUIRE_MIDGARD_READ_REPLICA &&
      value.MIDGARD_READ_REPLICA_URL === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["MIDGARD_READ_REPLICA_URL"],
        message: "is required when REQUIRE_MIDGARD_READ_REPLICA is true",
      });
    }
  });

/** Takes the environment rather than reading it, so the rules can be tested
 * without mutating the real process. */
export function parseConfig(
  env: NodeJS.ProcessEnv | Record<string, unknown>,
): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    // Every bad variable at once. Fixing configuration one restart per variable
    // is how a five minute problem becomes an hour. Names only, never values:
    // several of these are credentials.
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid backend configuration:\n  ${detail}`);
  }
  // No cast. `Config` is derived from this schema, so a field declared in the
  // type and absent from the schema is a compile error rather than a value
  // that is silently undefined at runtime.
  return parsed.data;
}

export const config: Config = parseConfig(process.env);
