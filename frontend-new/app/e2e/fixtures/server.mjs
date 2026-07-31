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
  TXS,
  WITHDRAWALS,
  addressResponse,
  blockDa,
  blockFinalization,
  blockRows,
} from "./data.mjs";

const PORT = Number(process.env.FIXTURE_PORT ?? 3101);
const LIMIT = 25;

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

const routes = [
  ["healthz", /^\/healthz$/, () => ({ status: "ok", now: new Date().toISOString() })],

  [
    "blocks/by-height",
    /^\/api\/blocks\/by-height\/(\d+)$/,
    (m, res) => {
      const block = BLOCKS.find((b) => b.height === Number(m[1]));
      if (!block) return fail(res, 404, "Block not found.");
      return { header_hash: block.header_hash };
    },
  ],
  ["blocks/recent", /^\/api\/blocks\/recent$/, () => ({ rows: BLOCKS.slice(0, 7) })],
  ["blocks/total", /^\/api\/blocks\/total$/, () => ({ total: BLOCKS.length })],
  [
    "blocks/page",
    /^\/api\/blocks\/(\d+)$/,
    (m) =>
      page(
        BLOCKS.map(({ header_hash, time_stamp_tz }) => ({ header_hash, time_stamp_tz })),
        Number(m[1]),
      ),
  ],

  [
    "transactions/recent",
    /^\/api\/transactions\/recent$/,
    () => ({
      rows: TXS.slice(0, 7).map((t) => ({
        height: 40,
        header_hash: t.header_hash,
        tx_id: t.tx_id,
        time_stamp_tz: t.time_stamp_tz,
      })),
    }),
  ],
  ["transactions/total", /^\/api\/transactions\/total$/, () => ({ total: TXS.length })],
  [
    "transactions/page",
    /^\/api\/transactions\/(\d+)$/,
    (m) =>
      page(
        TXS.map((t) => ({
          header_hash: t.header_hash,
          tx_id: t.tx_id,
          time_stamp_tz: t.time_stamp_tz,
          transaction: t.transaction,
          decodeError: t.decodeError,
        })),
        Number(m[1]),
      ),
  ],

  ["deposits", /^\/api\/deposits\/(\d+)$/, (m) => page(DEPOSITS, Number(m[1]))],
  ["withdrawals", /^\/api\/withdrawals\/(\d+)$/, (m) => page(WITHDRAWALS, Number(m[1]))],
  ["forced-transactions", /^\/api\/forced-transactions\/(\d+)$/, (m) => page(FORCED, Number(m[1]))],
];

const handleBlock = (url, res) => {
  const hash = url.searchParams.get("header_hash");
  if (!hash || !/^[0-9a-f]{56}$/i.test(hash)) return fail(res, 400, "bad_request", "header_hash");
  const found = BLOCKS.find((b) => b.header_hash === hash.toLowerCase());
  if (!found) return fail(res, 404, "not_found");
  return json(res, {
    rows: blockRows(found.height),
    da: blockDa(found.height),
    finalization: blockFinalization(found.height),
  });
};

const handleTransaction = (url, res) => {
  const hash = url.searchParams.get("tx_hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return fail(res, 400, "bad_request", "tx_hash");
  const found = TXS.find((t) => t.tx_id === hash.toLowerCase());
  if (!found) return fail(res, 404, "not_found");
  // Undecodable rows surface as 422 on the detail route, matching the backend.
  if (found.decodeError) return fail(res, 422, "decode_failed", found.decodeError);
  if (!found.transaction || found.status === "rejected") {
    return json(res, {
      transaction: null,
      status: found.status,
      admission: found.admission,
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
  return json(res, {
    transaction: { ...found.transaction, timestamp: found.time_stamp_tz },
    status: found.status,
    admission: found.admission,
  });
};

const handleAddress = (url, res) => {
  const address = url.searchParams.get("address");
  if (!address) return fail(res, 400, "bad_request", "address");
  if (!ADDRESSES.includes(address)) return fail(res, 404, "not_found");
  return json(res, addressResponse(address));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "POST" && url.pathname === "/__control") {
    state.fail = url.searchParams.get("fail");
    state.slowMs = Number(url.searchParams.get("slow") ?? 0);
    return json(res, { ok: true, ...state });
  }

  if (state.slowMs > 0) await new Promise((r) => setTimeout(r, state.slowMs));

  for (const [name, pattern, handler] of routes) {
    const m = pattern.exec(url.pathname);
    if (!m) continue;
    if (state.fail === "all" || state.fail === name) {
      return fail(res, 500, "internal_error", `injected failure for ${name}`);
    }
    // A handler that writes its own response (a 404, say) returns undefined.
    const out = handler(m, res);
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
  if (url.pathname === "/api/address") {
    if (state.fail === "all" || state.fail === "address") return fail(res, 500, "internal_error");
    return handleAddress(url, res);
  }

  return fail(res, 404, "not_found", url.pathname);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fixture backend on http://127.0.0.1:${PORT}`);
});
