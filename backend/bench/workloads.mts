/**
 * The workload catalogue: one entry per performance budget.
 *
 * Paths are built from the endpoint catalogue's own templates rather than
 * written by hand, because a hand-written path that 404s produces a fast,
 * confident, meaningless number. `template` is the catalogue form
 * (`/api/blocks/:page`); `buildPath` is the concrete request. The test asserts
 * the second matches the first and that the template is one the server serves.
 *
 * `cacheMode` is not a detail. Every `/api/` route carries a five-second
 * response cache by default (`catalogue.ts:137`), so repeating one path
 * measures the cache. A database budget may never rest on a warm reading.
 *
 * `cold` means APPLICATION-cache cold: BOTH layers empty. `/api/metrics` and
 * `/api/assets` each have two, a `cachePublicJson` response entry and an inner
 * `cached(...)` work entry with its own 10s TTL. `clearCache()` empties both,
 * but it is in-process and unreachable from a separately running server, so a
 * cold run comes from restarting the process or from a benchmark-only bypass
 * gated on an env flag that is off in production. It does NOT mean a cold
 * PostgreSQL buffer cache; that is reported separately as shared blocks.
 */

export type Origin = "backend" | "frontend";
export type CacheMode = "cold" | "warm" | "unique-key";
export type ProfileName = "small" | "target" | "stress";

export type SeededIds = {
  /** 56 hex characters. 28 bytes, matching `isHash28`. */
  blockHash: string;
  /** 64 hex characters. 32 bytes. */
  txId: string;
  address: string;
  page: number;
};

export type Budget = {
  p95Ms: number;
  /** Required, not optional: a p95 alone hides the tail pages actually stall on. */
  p99Ms: number;
  maxErrorRate: number;
  /** Separate from errors: a timeout is a failure even when a body comes back. */
  maxTimeoutRate: number;
  minRps?: number;
  maxDbStatements?: number;
  /**
   * Total shared blocks touched, `hit + read`, across BOTH databases.
   *
   * Not `shared read` alone. A full scan served entirely from shared buffers
   * reports zero reads and would pass a read-only budget while doing exactly
   * the work the budget exists to catch.
   */
  maxSharedBlocks?: number;
  maxTempBytes?: number;
  /** Bytes on the wire, read from the response stream, not a decoded body. */
  maxWireBytes?: number;
  /** Identity-encoded size, so the ratio is computable per route. */
  maxUncompressedBytes?: number;
};

export type Workload = {
  name: string;
  origin: Origin;
  /** The catalogue template this workload exercises. */
  template: string;
  buildPath: (ids: SeededIds) => string;
  cacheMode: CacheMode;
  concurrency: number;
  profile: ProfileName;
  budget: Budget;
  /**
   * Always `explorer`. Answering the request is ours even when the index it
   * needs belongs to another team; that constraint is `dependency`.
   */
  owner: "explorer";
  /** An open upstream request this budget depends on, or null. */
  dependency: string | null;
};

/**
 * Targets below were APPROVED on 2026-09-04 and await a baseline.
 *
 * They are intentions, not measurements: no row here has been measured yet, so
 * a target is what we have decided to hold ourselves to, never evidence that we
 * do. `docs/performance-budgets.md` carries the lifecycle each row moves
 * through, and `BASELINES` is what turns these into PASS, FAIL, BLOCKED or
 * INSUFFICIENT.
 */
export const WORKLOADS: readonly Workload[] = [
  {
    name: "blocks-list-page-1",
    origin: "backend",
    template: "/api/blocks/:page",
    buildPath: () => "/api/blocks/1",
    cacheMode: "cold",
    concurrency: 1,
    profile: "target",
    budget: { p95Ms: 200, p99Ms: 400, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 4, maxTempBytes: 0 },
    owner: "explorer",
    dependency: "UR-1",
  },
  {
    name: "blocks-list-page-deep",
    origin: "backend",
    template: "/api/blocks/:page",
    buildPath: () => "/api/blocks/100",
    cacheMode: "cold",
    concurrency: 1,
    profile: "target",
    budget: { p95Ms: 300, p99Ms: 600, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 4, maxTempBytes: 0 },
    owner: "explorer",
    dependency: "UR-1",
  },
  {
    name: "transactions-list-page-1",
    origin: "backend",
    template: "/api/transactions/:page",
    buildPath: () => "/api/transactions/1",
    cacheMode: "cold",
    concurrency: 1,
    profile: "target",
    budget: { p95Ms: 200, p99Ms: 400, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 4, maxTempBytes: 0 },
    owner: "explorer",
    dependency: "UR-1",
  },
  {
    name: "transactions-list-page-deep",
    origin: "backend",
    template: "/api/transactions/:page",
    buildPath: () => "/api/transactions/100",
    cacheMode: "cold",
    concurrency: 1,
    profile: "target",
    budget: { p95Ms: 300, p99Ms: 600, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 4, maxTempBytes: 0 },
    owner: "explorer",
    dependency: "UR-1",
  },
  {
    name: "block-detail",
    origin: "backend",
    template: "/api/block",
    buildPath: (ids) => `/api/block?header_hash=${ids.blockHash}`,
    cacheMode: "unique-key",
    concurrency: 1,
    profile: "target",
    budget: { p95Ms: 250, p99Ms: 500, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 8, maxWireBytes: 128 * 1024, maxUncompressedBytes: 512 * 1024 },
    owner: "explorer",
    dependency: null,
  },
  {
    name: "transaction-detail",
    origin: "backend",
    template: "/api/transaction",
    buildPath: (ids) => `/api/transaction?tx_hash=${ids.txId}`,
    cacheMode: "unique-key",
    concurrency: 1,
    profile: "target",
    // Carries cborHex, capped at MAX_INLINE_CBOR_BYTES (64 KB).
    budget: { p95Ms: 250, p99Ms: 500, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 8, maxWireBytes: 192 * 1024, maxUncompressedBytes: 768 * 1024 },
    owner: "explorer",
    dependency: null,
  },
  {
    name: "search-prefix",
    origin: "backend",
    template: "/api/search",
    buildPath: (ids) => `/api/search?q=${ids.blockHash.slice(0, 8)}`,
    cacheMode: "unique-key",
    concurrency: 1,
    profile: "target",
    // Documented as non-indexable at db/search.ts:11-16; bounded by MIN_PREFIX
    // and MAX_RESULTS rather than by an index.
    budget: { p95Ms: 400, p99Ms: 800, maxTimeoutRate: 0, maxErrorRate: 0, maxSharedBlocks: 200_000 },
    owner: "explorer",
    dependency: null,
  },
  {
    name: "metrics",
    origin: "backend",
    template: "/api/metrics",
    buildPath: () => "/api/metrics",
    cacheMode: "cold",
    concurrency: 1,
    profile: "target",
    // Nine statements serialized on one connection inside readConsistently.
    budget: { p95Ms: 500, p99Ms: 1000, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 9 },
    owner: "explorer",
    dependency: null,
  },
  {
    name: "metrics-cached",
    origin: "backend",
    template: "/api/metrics",
    buildPath: () => "/api/metrics",
    cacheMode: "warm",
    concurrency: 1,
    profile: "target",
    // Measures the cache deliberately: the 10s entry cache should make this an
    // order of magnitude cheaper than the cold reading above.
    budget: { p95Ms: 20, p99Ms: 40, maxTimeoutRate: 0, maxErrorRate: 0 },
    owner: "explorer",
    dependency: null,
  },
  {
    name: "asset-roster",
    origin: "backend",
    template: "/api/assets",
    buildPath: () => "/api/assets",
    cacheMode: "cold",
    concurrency: 1,
    profile: "target",
    // Decodes up to SCAN_LIMIT UTxOs from canonical CBOR per uncached call.
    budget: { p95Ms: 800, p99Ms: 1600, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 2 },
    owner: "explorer",
    dependency: null,
  },
  {
    name: "address-history",
    origin: "backend",
    template: "/api/address",
    buildPath: (ids) => `/api/address?address=${encodeURIComponent(ids.address)}&page=1`,
    cacheMode: "unique-key",
    concurrency: 1,
    profile: "target",
    // Sorts on time_stamp_tz, which IS indexed upstream, so this should pass
    // without UR-1. If it does not, the diagnosis is not the missing index.
    budget: { p95Ms: 250, p99Ms: 500, maxTimeoutRate: 0, maxErrorRate: 0, maxDbStatements: 6 },
    owner: "explorer",
    dependency: null,
  },
  {
    name: "overview-aggregate",
    origin: "frontend",
    template: "/api/overview",
    buildPath: () => "/api/overview",
    cacheMode: "cold",
    concurrency: 1,
    profile: "target",
    // One browser request, six backend calls in parallel (lib/overview.ts:6-12),
    // polled every 10s.
    budget: { p95Ms: 600, p99Ms: 1200, maxTimeoutRate: 0, maxErrorRate: 0, maxWireBytes: 256 * 1024, maxUncompressedBytes: 1024 * 1024 },
    owner: "explorer",
    dependency: null,
  },
  {
    name: "blocks-list-saturation",
    origin: "backend",
    template: "/api/blocks/:page",
    buildPath: (ids) => `/api/blocks/${ids.page}`,
    // `cold`, not `unique-key`. The id pool yields 25 distinct pages, so a run
    // longer than 25 requests repeats them, and at concurrency 32 the repeats
    // can share one in-flight cached promise. That turns a saturation test into
    // a measurement of the cache coalescing duplicate work, and it passed on
    // exactly that. The bypass makes every one of the 32 concurrent requests do
    // the real query, which is the queueing this row is meant to measure.
    cacheMode: "cold",
    concurrency: 32,
    profile: "target",
    // Throughput budget: the pool is bounded, so this measures queueing rather
    // than a single query.
    budget: {
      p95Ms: 1_500,
      p99Ms: 3_000,
      minRps: 20,
      maxTimeoutRate: 0.001,
      maxErrorRate: 0.01,
    },
    owner: "explorer",
    dependency: "UR-1",
  },
];
