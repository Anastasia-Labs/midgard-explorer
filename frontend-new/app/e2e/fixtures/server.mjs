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
  PAGED_ADDRESS,
  BLOCKS,
  DEPOSITS,
  FORCED,
  FLOW_STRESS_TX,
  FLOW_UNEQUAL_TX,
  PAYMENT_TX,
  L1_VALIDATORS,
  TXS,
  WITHDRAWALS,
  addressResponse,
  blockCommitments,
  blockDa,
  blockEvents,
  blockFinalization,
  blockHeader,
  blockRows,
  metrics,
  asset,
  assets,
} from "./data.mjs";

/* The deployment context and association every detail response now carries.
 *
 * Declared once here for the same reason it is declared once in the contracts:
 * a fixture that spells the shape differently per route is how the fixture and
 * the backend drift apart, which is exactly what let a broken block key ship
 * behind a green end-to-end suite.
 *
 * The source kind is `fixture`, which is the honest answer and is what the
 * frontend reads to suppress links to a live Cardano explorer. */
const midgardContext = () => ({
  deploymentId: "fixture0000000000000000000000000000000000000000000000000000000000",
  network: "preprod",
  networkMagic: null,
  database: "midgard_fixture",
  sourceKind: "fixture",
  // Configured, not verified: the fixture names a deployment and nothing
  // checks it, which is exactly the real backend's position.
  identityState: "configured",
  freshness: { state: "synthetic", observedAsOf: null, lagSeconds: null },
});

/**
 * The states this build recognises, and the mapping the backend applies.
 *
 * `settlementState` in the backend turns a status it does not know into
 * `unknown` while `rawState` keeps the node's own word. The fixture passed the
 * raw status straight through as `state`, so its deliberate
 * `some_future_finalization_stage` case produced a payload the real API cannot
 * emit, and once the contract narrowed to the node's vocabulary the block page
 * failed to decode. A fixture that can express what the API cannot is not
 * testing the API.
 */
const SETTLEMENT_STATES = new Set([
  "pending_submission",
  "submitted_local_finalization_pending",
  "submitted_unconfirmed",
  "observed_waiting_stability",
  "finalized",
  "abandoned",
  "orphaned",
  "unknown",
]);

const settlementState = (raw) => (SETTLEMENT_STATES.has(raw) ? raw : "unknown");

/* The settlement association, as the backend builds it from the node's record.
 *
 * Three verdicts, and the fixture reaches two of them. `node_reported` needs a
 * hash, `none` is a record with none. `unavailable` is reached only when the
 * Midgard source is not current, and this fixture's context is `synthetic`, so a
 * block claiming it would be a payload no route can produce; its wording is
 * covered in `test/association-panel.test.tsx`.
 *
 * The fixture used to spread seven verdicts across blocks, most of them
 * comparisons with an explorer-owned Cardano index. That index is
 * decommissioned, and so are they. */
const blockAssociation = (headerHash, l1TxHash, status) => ({
  kind: "block_settlement",
  deploymentId: midgardContext().deploymentId,
  network: "preprod",
  reconciliation: l1TxHash === null ? "none" : "node_reported",
  l2ObservedAsOf: null,
  evidence:
    l1TxHash === null && status === null
      ? []
      : [
          {
            source: "midgard_finalization_journal",
            transactionHash: l1TxHash,
            outputIndex: null,
            blockHeight: null,
            observedAt: null,
            rawState: status,
          },
        ],
  l2BlockHeaderHash: headerHash,
  l1TxHash,
  state: settlementState(status),
});

/* Midgard's Cardano footprint, as the node recorded it: the same union the
 * backend reads from four tables, built from the fixture's own four sources. */
const cardanoActivity = () =>
  [
    ...BLOCKS.map((block) => ({ block, fin: blockFinalization(block.number) }))
      .filter(({ fin }) => fin !== null && fin.submitted_tx_hash !== null)
      .map(({ block, fin }) => ({
        kind: "settlement",
        l1TxHash: fin.submitted_tx_hash,
        outputIndex: null,
        recordedAt: fin.updatedAt,
        status: fin.status,
        headerHash: block.header_hash,
        recordId: null,
      })),
    ...DEPOSITS.map((row) => ({
      kind: "deposit",
      l1TxHash: row.deposit_l1_tx_hash,
      outputIndex: null,
      recordedAt: row.inclusion_time,
      status: row.status,
      headerHash: row.projected_header_hash,
      recordId: row.event_id,
    })),
    ...WITHDRAWALS.map((row) => ({
      kind: "withdrawal",
      l1TxHash: row.withdrawal_l1_tx_hash,
      outputIndex: row.withdrawal_l1_output_index,
      recordedAt: row.inclusion_time,
      status: row.status,
      headerHash: row.projected_header_hash,
      recordId: row.event_id,
    })),
    ...FORCED.map((row) => ({
      kind: "forced_transaction",
      l1TxHash: row.tx_order_l1_tx_hash,
      outputIndex: row.tx_order_l1_output_index,
      recordedAt: row.inclusion_time,
      status: row.status,
      headerHash: row.projected_header_hash,
      recordId: row.tx_order_id,
    })),
  ].sort((a, b) =>
    a.recordedAt === b.recordedAt
      ? b.l1TxHash.localeCompare(a.l1TxHash)
      : b.recordedAt.localeCompare(a.recordedAt),
  );

/* The manifest's validators, in the shape the backend serves. */
const manifestValidators = () =>
  L1_VALIDATORS.map((v) => ({
    family: v.family,
    purpose: v.entryName.endsWith("Mint") ? "Mint" : "Spend",
    scriptHash: v.scriptHash,
    address: v.address,
    rewardAddress: null,
    policyId: null,
    placeholder: false,
  }));

const PORT = Number(process.env.FIXTURE_PORT ?? 3101);
const LIMIT = 25;

/** Answered by `GET /__control` so the suite can identify this process. */
const FIXTURE_ID = "midgard-explorer-e2e";

const state = { fail: null, slowMs: 0, health: null };

/** The fixture chain abandons a third of its settlements, which is the state
 * most of the suite needs. `POST /__control?health=healthy` returns the same
 * shape with the two facts that make it degraded set to healthy values, so a
 * test can exercise the healthy presentation without a second fixture chain. */
const healthyMetrics = () => {
  const m = metrics();
  return {
    ...m,
    tip: { ...m.tip, ageSeconds: 12 },
    admission: { ...m.admission, rejected: 0, rejectionRate: 0 },
    finality: {
      ...m.finality,
      abandoned: 0,
      finalized: m.finality.finalized + m.finality.abandoned,
      oldestUnsettled: null,
    },
  };
};

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
  [
    "readyz",
    /^\/readyz$/,
    () => ({
      ready: true,
      now: new Date().toISOString(),
      checks: [
        { name: "midgard-node", ok: true, latencyMs: 1 },
        { name: "explorer-index", ok: true, latencyMs: 1 },
      ],
    }),
  ],
  ["openapi", /^\/api\/openapi\.json$/, () => openApiDocument()],
  [
    "metrics",
    /^\/api\/metrics$/,
    () => (state.health === "healthy" ? healthyMetrics() : metrics()),
  ],
  ["assets", /^\/api\/assets$/, () => assets()],
  [
    "search",
    /^\/api\/search$/,
    (_m, res, url) => {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      if (q.length < 6 || !/^[0-9a-f]+$/.test(q)) {
        return { hits: [], minPrefix: 6, tooShort: q.length < 6 };
      }
      // A block is found by its header hash or by the settlement hash the node
      // recorded for it, which is how a Cardano hash still resolves without a
      // chain index.
      const blocks = BLOCKS.filter(
        (b) =>
          b.header_hash.startsWith(q) ||
          (blockFinalization(b.number)?.submitted_tx_hash ?? "").startsWith(q),
      ).map((b) => ({
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
      const validators = L1_VALIDATORS.filter((v) => v.scriptHash.startsWith(q)).map((v) => ({
        kind: "validator",
        scriptHash: v.scriptHash,
        family: v.family,
      }));
      const deposits = DEPOSITS.filter((row) => row.event_id.startsWith(q)).map((row) => ({
        kind: "deposit",
        eventId: row.event_id,
        txHash: row.deposit_l1_tx_hash,
      }));
      return {
        hits: [...blocks, ...txs, ...validators, ...deposits].slice(0, 10),
        minPrefix: 6,
        tooShort: false,
      };
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
        ...blockHeader(b.number),
        tx_count: blockHeader(b.number).header_l2_transaction_count,
        finalization_status: blockFinalization(b.number)?.status ?? "pending_submission",
      })),
    }),
  ],
  ["blocks/total", /^\/api\/blocks\/total$/, () => ({ total: BLOCKS.length })],
  [
    "blocks/page",
    /^\/api\/blocks\/(\d+)$/,
    (m, _res, url) => {
      const status = url.searchParams.get("status");
      const all = BLOCKS.map((block) => ({
        ...blockHeader(block.number),
        time_stamp_tz: block.time_stamp_tz,
        tx_count: blockHeader(block.number).header_l2_transaction_count,
        finalization_status: blockFinalization(block.number)?.status ?? "pending_submission",
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
        height: BLOCKS.find((b) => b.header_hash === t.header_hash)?.height ?? null,
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
        const height = BLOCKS.find((b) => b.header_hash === t.header_hash)?.height ?? null;
        const number = BLOCKS.find((b) => b.header_hash === t.header_hash)?.number ?? 0;
        return {
          height,
          header_hash: t.header_hash,
          tx_id: t.tx_id,
          time_stamp_tz: t.time_stamp_tz,
          // List rows come from the block table, so they are always in a
          // block; only which tier holds the bytes varies.
          status: t.status === "pending_commit" ? "pending_commit" : "committed",
          finalization_status: blockFinalization(number)?.status ?? null,
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

  [
    "deposits",
    /^\/api\/deposits\/(\d+)$/,
    (m, _res, url) =>
      page(
        url.searchParams.get("id")
          ? DEPOSITS.filter((row) => row.event_id === url.searchParams.get("id"))
          : DEPOSITS,
        Number(m[1]),
      ),
  ],
  [
    "withdrawals",
    /^\/api\/withdrawals\/(\d+)$/,
    (m, _res, url) =>
      page(
        url.searchParams.get("id")
          ? WITHDRAWALS.filter((row) => row.event_id === url.searchParams.get("id"))
          : WITHDRAWALS,
        Number(m[1]),
      ),
  ],
  [
    "forced-transactions",
    /^\/api\/forced-transactions\/(\d+)$/,
    (m, _res, url) =>
      page(
        url.searchParams.get("id")
          ? FORCED.filter((row) => row.tx_order_id === url.searchParams.get("id"))
          : FORCED,
        Number(m[1]),
      ),
  ],
  ["source", /^\/api\/source$/, () => midgardContext()],
  [
    "l1/activity/summary",
    /^\/api\/l1\/activity\/summary$/,
    () => {
      const rows = cardanoActivity();
      const byKind = ["settlement", "deposit", "withdrawal", "forced_transaction"].map((kind) => {
        const own = rows.filter((row) => row.kind === kind);
        return {
          kind,
          count: own.length,
          newestRecordedAt: own[0]?.recordedAt ?? null,
        };
      });
      return {
        midgard: midgardContext(),
        total: rows.length,
        newestRecordedAt: rows[0]?.recordedAt ?? null,
        byKind,
      };
    },
  ],
  [
    "l1/activity",
    /^\/api\/l1\/activity\/(\d+)$/,
    (m) => ({ midgard: midgardContext(), ...page(cardanoActivity(), Number(m[1])) }),
  ],
  [
    "l1/validators",
    /^\/api\/l1\/validators$/,
    () => ({
      midgard: midgardContext(),
      deploymentId: midgardContext().deploymentId,
      network: "preprod",
      validators: manifestValidators(),
    }),
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
  const fin = blockFinalization(found.number);
  return json(res, {
    midgard: midgardContext(),
    // Null status where the node has no finalization row, matching the
    // backend, so an unfinalized block carries no evidence row at all.
    cardano: blockAssociation(
      found.header_hash,
      fin?.submitted_tx_hash ?? null,
      fin?.status ?? null,
    ),
    header: blockHeader(found.number),
    rows: blockRows(found.number).map((row) => ({ ...row, height: found.height })),
    da: blockDa(found.number),
    finalization: fin,
    commitments: blockCommitments(found.number),
    events: blockEvents(found.number),
    neighbours: { prev: at(i + 1), next: at(i - 1) },
  });
};

const handleTransaction = (url, res) => {
  const hash = url.searchParams.get("tx_hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return fail(res, 400, "bad_request", "tx_hash");
  const found =
    TXS.find((t) => t.tx_id === hash.toLowerCase()) ??
    [FLOW_STRESS_TX, FLOW_UNEQUAL_TX, PAYMENT_TX].find((t) => t.tx_id === hash.toLowerCase()) ??
    null;
  if (!found) return fail(res, 404, "not_found");

  // Committed transactions carry inclusion, and inclusion carries settlement.
  const included = found.status === "committed" || found.status === "pending_commit";
  const inclusionBlock = BLOCKS.find((b) => b.header_hash === found.header_hash) ?? null;
  const inclusion =
    included && inclusionBlock
      ? {
          height: inclusionBlock.height,
          header_hash: found.header_hash,
          time_stamp_tz: found.time_stamp_tz,
        }
      : null;
  const txFin = inclusion ? blockFinalization(inclusionBlock.number) : null;
  const envelope = {
    txId: found.tx_id,
    admission: found.admission,
    inclusion,
    finalization: txFin,
    midgard: midgardContext(),
    // Settlement travels through the block. Every transaction in one block
    // reports the same hash here, which is the relationship the contract exists
    // to state and the fixture has to be able to exercise.
    cardano: {
      // Every transaction in one block reports that block's settlement.
      ...blockAssociation(
        inclusion?.header_hash ?? null,
        txFin?.submitted_tx_hash ?? null,
        txFin?.status ?? null,
      ),
      kind: "l2_transaction_settlement",
      l2TxId: found.tx_id,
      l2BlockHeaderHash: inclusion?.header_hash ?? null,
    },
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
  const rawPage = url.searchParams.get("page");
  const page = rawPage === null ? 1 : Number(rawPage);
  if (!address) return fail(res, 400, "bad_request", "address");
  if (!Number.isInteger(page) || page < 1) return fail(res, 400, "bad_request", "page");
  if (!ADDRESSES.includes(address) && address !== PAGED_ADDRESS) {
    return fail(res, 404, "not_found");
  }
  const utxoCursor = url.searchParams.get("utxo_cursor");
  if (utxoCursor !== null && !/^(?:[0-9a-fA-F]{2})*$/.test(utxoCursor)) {
    return fail(res, 400, "bad_request", "utxo_cursor");
  }
  return json(res, addressResponse(address, page, utxoCursor || null));
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
  if (req.method === "GET" && url.pathname === "/__flow-unequal") {
    return json(res, { txId: FLOW_UNEQUAL_TX.tx_id, inputs: 1, outputs: 3 });
  }
  // Which Cardano transaction demonstrates which action shape. Derived from the
  // fixture rather than restated in a spec, so a change to the data cannot
  // leave a test asserting against a transaction that no longer has the case.
  if (req.method === "GET" && url.pathname === "/__payment-tx") {
    return json(res, { txId: PAYMENT_TX.tx_id });
  }
  if (url.pathname.startsWith("/api/")) {
    forwarded.set(url.pathname, req.headers["x-forwarded-for"] ?? null);
  }

  if (req.method === "POST" && url.pathname === "/__control") {
    state.fail = url.searchParams.get("fail");
    state.slowMs = Number(url.searchParams.get("slow") ?? 0);
    state.health = url.searchParams.get("health") || null;
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
  if (url.pathname === "/api/l1/reference") {
    const hash = (url.searchParams.get("txHash") ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return fail(res, 400, "bad_request", "txHash");
    return json(res, {
      midgard: midgardContext(),
      txHash: hash,
      references: cardanoActivity().filter((row) => row.l1TxHash === hash),
    });
  }
  if (url.pathname === "/api/l1/validator") {
    const hash = (url.searchParams.get("scriptHash") ?? "").toLowerCase();
    if (!/^[0-9a-f]{56}$/.test(hash)) return fail(res, 400, "bad_request", "scriptHash");
    const validator = manifestValidators().find((v) => v.scriptHash === hash);
    if (!validator) return fail(res, 404, "not_found");
    return json(res, {
      midgard: midgardContext(),
      deploymentId: midgardContext().deploymentId,
      network: "preprod",
      validator,
    });
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
