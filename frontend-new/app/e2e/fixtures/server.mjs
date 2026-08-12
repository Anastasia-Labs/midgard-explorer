/** Zero-dependency stand-in for the explorer backend.
 *
 * Serves the same routes as backend/src/server/routes.ts so populated states can
 * be reviewed and tested without a live Midgard node. Fault injection via query
 * flags lets the e2e suite drive the degraded states on demand:
 *
 *   ?fail=all        every endpoint returns 500
 *   ?fail=<name>     one endpoint returns 500 (e.g. fail=blocks/recent)
 *   ?slow=<ms>       delay before responding
 *
 * Flags are set through the control endpoint POST /__control, so the app under
 * test does not need to forward them.
 */
import { createServer } from "node:http";
import {
  ADDRESSES,
  BLOCKS,
  DEPOSITS,
  FORCED,
  FLOW_STRESS_TX,
  L1_VALIDATORS,
  L1_TXS,
  TXS,
  WITHDRAWALS,
  addressResponse,
  blockDa,
  blockFinalization,
  blockRows,
  metrics,
  asset,
  assets,
} from "./data.mjs";

const PORT = Number(process.env.FIXTURE_PORT ?? 3101);
const LIMIT = 25;

/** Answered by `GET /__control` so the suite can identify this process. */
const FIXTURE_ID = "midgard-explorer-e2e";

const state = { fail: null, slowMs: 0 };

const page = (rows, p) => {
  const safe = Number.isFinite(p) ? Math.max(1, Math.floor(p)) : 1;
  const start = (safe - 1) * LIMIT;
  const slice = rows.slice(start, start + LIMIT);
  return {
    rows: slice,
    hasNextPage: start + LIMIT < rows.length,
    total: rows.length,
    limit: LIMIT,
  };
};

const json = (res, body, status = 200) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

const fail = (res, status, error, detail) => json(res, { error, detail }, status);

/** A small OpenAPI document, deliberately not a copy of the backend's.
 *
 * The API reference page renders whatever document the server hands it, so what
 * the e2e suite must prove is faithful rendering: every path in the document
 * appears, the group order is the tag order, and a 429 response shows as a rate
 * limit. Whether the real document is correct is the backend's question, and
 * `catalogue.test.mts` answers it against the routes it registers. Reproducing
 * all 24 real endpoints here would just be a fifth copy of the API. */
const openApiDocument = () => ({
  openapi: "3.1.0",
  info: {
    title: "Midgard Explorer API",
    version: "1.0.0",
    description: "Integer ledger quantities are returned as decimal strings.",
  },
  servers: [{ url: "/", description: "This explorer backend" }],
  tags: [{ name: "System" }, { name: "Blocks" }],
  paths: {
    "/healthz": {
      get: {
        tags: ["System"],
        summary: "Report backend health",
        parameters: [],
        responses: { 200: {} },
      },
    },
    "/api/transaction": {
      get: {
        tags: ["System"],
        summary: "Return one Midgard transaction",
        parameters: [
          { name: "tx_hash", in: "query", required: false, description: "64-character hash." },
        ],
        responses: { 200: {}, 429: {} },
      },
    },
    "/api/blocks/{page}": {
      get: {
        tags: ["Blocks"],
        summary: "List blocks by page",
        parameters: [
          { name: "page", in: "path", required: true, description: "One-based page number." },
        ],
        responses: { 200: {}, 429: {} },
      },
    },
  },
});

const routes = [
  ["healthz", /^\/healthz$/, () => ({ status: "ok", now: new Date().toISOString() })],
  ["openapi", /^\/api\/openapi\.json$/, () => openApiDocument()],
  ["metrics", /^\/api\/metrics$/, () => metrics()],
  ["assets", /^\/api\/assets$/, () => assets()],
  [
    "search",
    /^\/api\/search$/,
    (_m, res, url) => {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      if (q.length < 6 || !/^[0-9a-f]+$/.test(q)) {
        return { hits: [], minPrefix: 6, tooShort: q.length < 6 };
      }
      const blocks = BLOCKS.filter((b) => b.header_hash.startsWith(q)).map((b) => ({
        kind: "block",
        headerHash: b.header_hash,
        height: b.height,
      }));
      const txs = TXS.filter((t) => t.tx_id.startsWith(q)).map((t) => ({
        kind: "transaction",
        txId: t.tx_id,
        height: BLOCKS.find((b) => b.header_hash === t.header_hash)?.height ?? null,
        headerHash: t.header_hash,
      }));
      return { hits: [...blocks, ...txs].slice(0, 10), minPrefix: 6, tooShort: false };
    },
  ],

  [
    "blocks/by-height",
    /^\/api\/blocks\/by-height\/(\d+)$/,
    (m, res) => {
      const block = BLOCKS.find((b) => b.height === Number(m[1]));
      if (!block) return fail(res, 404, "Block not found.");
      return { header_hash: block.header_hash };
    },
  ],
  [
    "blocks/recent",
    /^\/api\/blocks\/recent$/,
    () => ({
      rows: BLOCKS.slice(0, 7).map((b) => ({
        ...b,
        tx_count: blockRows(b.height).length,
        finalization_status: blockFinalization(b.height)?.status ?? null,
      })),
    }),
  ],
  ["blocks/total", /^\/api\/blocks\/total$/, () => ({ total: BLOCKS.length })],
  [
    "blocks/page",
    /^\/api\/blocks\/(\d+)$/,
    (m, _res, url) => {
      const status = url.searchParams.get("status");
      const all = BLOCKS.map(({ height, header_hash, time_stamp_tz }) => ({
        height,
        header_hash,
        time_stamp_tz,
        tx_count: blockRows(height).length,
        finalization_status: blockFinalization(height)?.status ?? null,
      }));
      // Narrowing before pagination, matching the backend: filtering the page
      // that happened to arrive would be a control that searches one screen.
      const rows = status ? all.filter((r) => r.finalization_status === status) : all;
      return page(rows, Number(m[1]));
    },
  ],

  [
    "transactions/recent",
    /^\/api\/transactions\/recent$/,
    () => ({
      rows: TXS.slice(0, 7).map((t) => ({
        height: BLOCKS.find((b) => b.header_hash === t.header_hash)?.height ?? 0,
        header_hash: t.header_hash,
        tx_id: t.tx_id,
        time_stamp_tz: t.time_stamp_tz,
        status: t.status === "pending_commit" ? "pending_commit" : "committed",
      })),
    }),
  ],
  ["transactions/total", /^\/api\/transactions\/total$/, () => ({ total: TXS.length })],
  [
    "transactions/page",
    /^\/api\/transactions\/(\d+)$/,
    (m, _res, url) => {
      const all = TXS.map((t) => {
        const height = BLOCKS.find((b) => b.header_hash === t.header_hash)?.height ?? 0;
        return {
          height,
          header_hash: t.header_hash,
          tx_id: t.tx_id,
          time_stamp_tz: t.time_stamp_tz,
          // List rows come from the block table, so they are always in a
          // block; only which tier holds the bytes varies.
          status: t.status === "pending_commit" ? "pending_commit" : "committed",
          finalization_status: blockFinalization(height)?.status ?? null,
          transaction: t.transaction,
          decodeError: t.decodeError,
        };
      });
      // Narrowing before pagination, matching the backend.
      const status = url.searchParams.get("status");
      const rows = status ? all.filter((r) => r.finalization_status === status) : all;
      return page(rows, Number(m[1]));
    },
  ],

  ["deposits", /^\/api\/deposits\/(\d+)$/, (m) => page(DEPOSITS, Number(m[1]))],
  ["withdrawals", /^\/api\/withdrawals\/(\d+)$/, (m) => page(WITHDRAWALS, Number(m[1]))],
  ["forced-transactions", /^\/api\/forced-transactions\/(\d+)$/, (m) => page(FORCED, Number(m[1]))],
  [
    "l1/summary",
    /^\/api\/l1\/summary$/,
    () => ({
      source: {
        deployment: "fixture-deployment",
        network: "preprod",
        deployedAt: "2026-07-01T00:00:00.000Z",
        l2Database: "midgard_fixture",
        isFixture: true,
        validators: L1_VALIDATORS,
      },
      transactions: L1_TXS.length,
      events: L1_TXS.reduce((sum, tx) => sum + tx.events.length, 0),
      blockHeaders: 18,
      lastSyncedHeight: 5_120_000,
      byValidator: [
        { validator: "deposit", count: 11 },
        { validator: "stateQueue", count: 1 },
      ],
    }),
  ],
  [
    "l1/transactions",
    /^\/api\/l1\/transactions\/(\d+)$/,
    (m) =>
      page(
        L1_TXS.map((tx) => ({
          txHash: tx.txHash,
          blockHeight: tx.blockHeight,
          blockHash: tx.blockHash,
          slot: tx.slot,
          epoch: tx.epoch,
          txTime: tx.txTime,
          fee: tx.fee,
          size: tx.size,
          totalOutput: tx.totalOutput,
          events: tx.events,
        })),
        Number(m[1]),
      ),
  ],
];

const handleBlock = (url, res) => {
  const hash = url.searchParams.get("header_hash");
  if (!hash || !/^[0-9a-f]{56}$/i.test(hash)) return fail(res, 400, "bad_request", "header_hash");
  const found = BLOCKS.find((b) => b.header_hash === hash.toLowerCase());
  if (!found) return fail(res, 404, "not_found");
  // Heights descend through BLOCKS, so the neighbour in the list is the
  // neighbour on the chain. Real heights are not consecutive, which is exactly
  // why the control shows the number rather than a bare arrow.
  const i = BLOCKS.indexOf(found);
  const at = (n) => {
    const b = BLOCKS[n];
    return b ? { height: b.height, header_hash: b.header_hash } : null;
  };
  return json(res, {
    rows: blockRows(found.height),
    da: blockDa(found.height),
    finalization: blockFinalization(found.height),
    neighbours: { prev: at(i + 1), next: at(i - 1) },
  });
};

const handleTransaction = (url, res) => {
  const hash = url.searchParams.get("tx_hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return fail(res, 400, "bad_request", "tx_hash");
  const found =
    TXS.find((t) => t.tx_id === hash.toLowerCase()) ??
    (FLOW_STRESS_TX.tx_id === hash.toLowerCase() ? FLOW_STRESS_TX : null);
  if (!found) return fail(res, 404, "not_found");

  // Committed transactions carry inclusion, and inclusion carries settlement.
  const included = found.status === "committed" || found.status === "pending_commit";
  const height = BLOCKS.find((b) => b.header_hash === found.header_hash)?.height ?? null;
  const inclusion =
    included && height !== null
      ? { height, header_hash: found.header_hash, time_stamp_tz: found.time_stamp_tz }
      : null;
  const envelope = {
    txId: found.tx_id,
    admission: found.admission,
    inclusion,
    finalization: inclusion ? blockFinalization(inclusion.height) : null,
  };

  // Lifecycle-only outcomes come first, matching the backend: a transaction
  // that never reached a ledger tier is never handed to the decoder, so
  // "rejected" and "undecodable body" cannot both describe one transaction.
  // Lifecycle-only means the node has no body at all, which is not the same as
  // having one it cannot read.
  if (found.status === "rejected" || (!found.transaction && !found.decodeError)) {
    return json(res, {
      ...envelope,
      transaction: null,
      status: found.status,
      ...(found.status === "rejected"
        ? {
            rejection: {
              reasonCode: "FeeTooLow",
              reasonDetail: "fee 150000 below minimum 170000 for 1024 bytes",
              rejectedAt: found.time_stamp_tz,
            },
          }
        : {}),
    });
  }
  // A body that will not decode is still a transaction: everything outside the
  // body is returned with a 200, matching the backend.
  if (found.decodeError) {
    return json(res, {
      ...envelope,
      transaction: null,
      status: found.status,
      decodeError: { code: "undecodable_body", detail: found.decodeError },
    });
  }
  // Only this route carries the raw bytes, matching the backend: list rows
  // leave `cborHex` null so a page response is not multiplied by its
  // transactions. One transaction is oversized so the truncation path is
  // exercised rather than assumed.
  const oversized = found.transaction.size > 600;
  return json(res, {
    ...envelope,
    transaction: {
      ...found.transaction,
      cborHex: "a3" + (found.tx_id + found.tx_id).slice(0, oversized ? 512 : 128),
      cborTruncated: oversized,
      timestamp: found.time_stamp_tz,
    },
    status: found.status,
  });
};

const handleAddress = (url, res) => {
  const address = url.searchParams.get("address");
  if (!address) return fail(res, 400, "bad_request", "address");
  if (!ADDRESSES.includes(address)) return fail(res, 404, "not_found");
  return json(res, addressResponse(address));
};

const handleL1Transaction = (url, res) => {
  const hash = url.searchParams.get("txHash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return fail(res, 400, "bad_request", "txHash");
  }
  const found = L1_TXS.find((tx) => tx.txHash === hash.toLowerCase());
  return found ? json(res, found) : fail(res, 404, "not_found");
};

/** The last client address this fixture was told about, per path. The backend
 * rate-limits per client, so a server-rendered page that does not forward the
 * viewer's address puts every reader into one bucket. Only a request that
 * arrives here can show whether it was forwarded. */
const forwarded = new Map();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/__forwarded") {
    return json(res, Object.fromEntries(forwarded));
  }
  if (req.method === "GET" && url.pathname === "/__flow-stress") {
    return json(res, { txId: FLOW_STRESS_TX.tx_id, nodes: 503 });
  }
  if (url.pathname.startsWith("/api/")) {
    forwarded.set(url.pathname, req.headers["x-forwarded-for"] ?? null);
  }

  if (req.method === "POST" && url.pathname === "/__control") {
    state.fail = url.searchParams.get("fail");
    state.slowMs = Number(url.searchParams.get("slow") ?? 0);
    return json(res, { ok: true, ...state });
  }

  // Identity, so the suite can prove the process on this port is this fixture.
  // `reuseExistingServer` adopts whatever is already listening, and a stray dev
  // server or an older fixture answering these paths would produce results that
  // describe nothing.
  if (req.method === "GET" && url.pathname === "/__control") {
    return json(res, { fixture: FIXTURE_ID, ...state });
  }

  if (state.slowMs > 0) await new Promise((r) => setTimeout(r, state.slowMs));

  for (const [name, pattern, handler] of routes) {
    const m = pattern.exec(url.pathname);
    if (!m) continue;
    if (state.fail === "all" || state.fail === name) {
      return fail(res, 500, "internal_error", `injected failure for ${name}`);
    }
    // A handler that writes its own response (a 404, say) returns undefined.
    const out = handler(m, res, url);
    return out === undefined ? undefined : json(res, out);
  }

  if (url.pathname === "/api/block") {
    if (state.fail === "all" || state.fail === "block") return fail(res, 500, "internal_error");
    return handleBlock(url, res);
  }
  if (url.pathname === "/api/transaction") {
    if (state.fail === "all" || state.fail === "transaction")
      return fail(res, 500, "internal_error");
    return handleTransaction(url, res);
  }
  if (url.pathname === "/api/l1/transaction") {
    if (state.fail === "all" || state.fail === "l1/transaction") {
      return fail(res, 500, "internal_error");
    }
    return handleL1Transaction(url, res);
  }
  if (url.pathname === "/api/asset") {
    if (state.fail === "all" || state.fail === "asset") return fail(res, 500, "internal_error");
    const policyId = url.searchParams.get("policy_id");
    const assetName = url.searchParams.get("asset_name") ?? "";
    if (!policyId || !/^[0-9a-f]{56}$/i.test(policyId)) {
      return fail(res, 400, "bad_request", "policy_id");
    }
    const found = asset(policyId.toLowerCase(), assetName.toLowerCase());
    return found === null ? fail(res, 404, "not_found") : json(res, found);
  }
  if (url.pathname === "/api/address") {
    if (state.fail === "all" || state.fail === "address") return fail(res, 500, "internal_error");
    return handleAddress(url, res);
  }

  return fail(res, 404, "not_found", url.pathname);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fixture backend on http://127.0.0.1:${PORT}`);
});
