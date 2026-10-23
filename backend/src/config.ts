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
  /**
   * Whether this process sits behind an edge that rewrites client identity.
   *
   * This was a hop COUNT accepting 0 to 8, which modelled a topology that does
   * not exist: there is exactly one overwriting edge, and every value above 1
   * was a way to misconfigure trust rather than a deployment anyone runs. The
   * two states the system actually has are named instead.
   */
  TRUSTED_PROXY_MODE: z.enum(["none", "single-edge"]).default("none"),

  /**
   * The peers allowed to state a client identity, as exact addresses or IPv4
   * CIDR blocks.
   *
   * Trust used to be granted to any peer in a private range, so anything that
   * could reach the port from inside the network could claim to be the edge.
   * Required when TRUSTED_PROXY_MODE is single-edge, and ignored otherwise.
   */
  TRUSTED_PROXY_PEERS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  API_RATE_LIMIT_MAX: positive.default(120),
  API_RATE_LIMIT_WINDOW_MS: positive.default(60_000),
  LOG_LOCATION: required,
  // The parts a POSTGRES_URL is usually assembled from, and nothing reads them
  // to connect: `POSTGRES_URL` is the only connection setting. They were
  // REQUIRED, so a deployment that supplies a complete URL and no components
  // was refused at boot over five values the process never looks at.
  //
  // Kept rather than dropped, because operators do compose the URL from them
  // through dotenv-expand, and `reconcile.ts` prints the port. Optional now, so
  // supplying the URL alone is a valid deployment.
  //
  // `blank` treats `POSTGRES_HOST=` as absent rather than failing. An empty
  // value counts as missing everywhere else in this schema, and an optional
  // setting that refuses an empty line would contradict that.
  POSTGRES_HOST: blank(required).optional(),
  POSTGRES_PORT: blank(positive).optional(),
  POSTGRES_USER: blank(required).optional(),
  POSTGRES_PASSWORD: blank(required).optional(),
  POSTGRES_DB: blank(required).optional(),
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
    // Trusting an edge without naming it is the misconfiguration this pair
    // exists to prevent: every request would fall back to the socket peer,
    // which reads as working until one client is limited on behalf of all.
    if (
      value.TRUSTED_PROXY_MODE === "single-edge" &&
      value.TRUSTED_PROXY_PEERS.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["TRUSTED_PROXY_PEERS"],
        message:
          "must name the edge's address or CIDR when TRUSTED_PROXY_MODE is single-edge",
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
