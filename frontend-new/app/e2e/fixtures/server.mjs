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
  FLOW_UNEQUAL_TX,
  PAYMENT_TX,
  L1_VALIDATORS,
  L1_TXS,
  TXS,
  WITHDRAWALS,
  addressResponse,
  blockDa,
  blockEvents,
  blockFinalization,
  blockHeader,
  blockRows,
  metrics,
  asset,
  assets,
} from "./data.mjs";

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
      const l1 = L1_TXS.filter((t) => t.txHash.startsWith(q)).map((t) => ({
        kind: "l1Transaction",
        txHash: t.txHash,
        blockHeight: t.blockHeight,
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
        hits: [...blocks, ...txs, ...l1, ...validators, ...deposits].slice(0, 10),
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
    header: blockHeader(found.number),
    rows: blockRows(found.number).map((row) => ({ ...row, height: found.height })),
    da: blockDa(found.number),
    finalization: blockFinalization(found.number),
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
  const envelope = {
    txId: found.tx_id,
    admission: found.admission,
    inclusion,
    finalization: inclusion ? blockFinalization(inclusionBlock.number) : null,
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
  if (!ADDRESSES.includes(address)) return fail(res, 404, "not_found");
  return json(res, addressResponse(address, page));
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
  if (req.method === "GET" && url.pathname === "/__flow-unequal") {
    return json(res, { txId: FLOW_UNEQUAL_TX.tx_id, inputs: 1, outputs: 3 });
  }
  // Which Cardano transaction demonstrates which action shape. Derived from the
  // fixture rather than restated in a spec, so a change to the data cannot
  // leave a test asserting against a transaction that no longer has the case.
  if (req.method === "GET" && url.pathname === "/__payment-tx") {
    return json(res, { txId: PAYMENT_TX.tx_id });
  }
  if (req.method === "GET" && url.pathname === "/__l1-specimens") {
    const withAction = (predicate) =>
      L1_TXS.find((tx) => tx.actions.some(predicate))?.txHash ?? null;
    return json(res, {
      decodedDeposit: withAction((a) => a.userEvent?.kind === "deposit"),
      decodedWithdrawal: withAction((a) => a.userEvent?.kind === "withdrawal"),
      failedContract: withAction((a) => a.validContract === false),
      // The one transaction carrying every UTxO section, found by the fact
      // that distinguishes it rather than by the generator's index.
      spentOutput: L1_TXS.find((tx) => tx.outputs.some((o) => o.spentBy))?.txHash ?? null,
    });
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
  if (url.pathname === "/api/l1/transaction") {
    if (state.fail === "all" || state.fail === "l1/transaction") {
      return fail(res, 500, "internal_error");
    }
    return handleL1Transaction(url, res);
  }
  if (url.pathname === "/api/l1/block-headers" || url.pathname === "/api/l1/block-header") {
    const rows = BLOCKS.map((block) => {
      const da = blockDa(block.number) ?? blockDa(1);
      // The oldest block is left unattributed on purpose. A commit transaction
      // re-outputs the previous queue node alongside the new head, so a header
      // really can be seen carried forward before the transaction that
      // committed it is observed, and the page has to say so rather than
      // render an empty cell. Without one here that branch is never rendered.
      const attributed = block.number > 1;
      return {
        headerHash: block.header_hash,
        l1TxHash: attributed ? L1_TXS[block.number % L1_TXS.length].txHash : null,
        blockHeight: attributed ? 5_120_000 - block.number : null,
        prevUtxosRoot: "00".repeat(32),
        utxosRoot: da.utxos_root,
        withdrawalsRoot: da.withdrawals_root,
        forcedTransactionsRoot: da.forced_transactions_root,
        transactionsRoot: da.transactions_root,
        depositsRoot: da.deposits_root,
        transitionTraceRoot: da.transition_trace_root,
        eventToStepRoot: da.event_to_step_root,
        withdrawalCount: String(da.withdrawal_count),
        forcedTransactionCount: String(da.forced_transaction_count),
        l2TransactionCount: String(da.l2_transaction_count),
        depositCount: String(da.deposit_count),
        totalEventCount: String(da.total_event_count),
        transitionStepCount: String(da.transition_step_count),
        startTime: String(new Date(da.block_start_time).getTime()),
        endTime: String(new Date(da.block_end_time).getTime()),
        prevHeaderHash:
          BLOCKS.find((candidate) => candidate.number === Math.max(1, block.number - 1))
            ?.header_hash ?? block.header_hash,
        operatorVkey: L1_VALIDATORS[1].scriptHash,
        protocolVersion: "1",
      };
    });
    if (url.pathname.endsWith("block-header")) {
      const found = rows.find((row) => row.headerHash === url.searchParams.get("headerHash"));
      return found ? json(res, found) : fail(res, 404, "not_found");
    }
    return json(res, rows.slice(0, Number(url.searchParams.get("limit") ?? 25)));
  }
  if (url.pathname === "/api/l1/deposits") {
    const rows = L1_TXS.flatMap((tx) =>
      tx.events
        .filter((event) => event.validator === "deposit")
        .map((event) => ({
          ...event,
          txHash: tx.txHash,
          fundingAddresses: tx.inputs.flatMap((input) => (input.address ? [input.address] : [])),
          tx,
        })),
    );
    return json(res, rows.slice(0, Number(url.searchParams.get("limit") ?? 25)));
  }
  if (url.pathname === "/api/l1/validator") {
    const validator = L1_VALIDATORS.find(
      (row) => row.scriptHash === url.searchParams.get("scriptHash"),
    );
    if (!validator) return fail(res, 404, "not_found");
    const rich = L1_TXS[0];
    const history = L1_TXS.filter(
      (tx) =>
        tx.redeemers.some((row) => row.scriptHash === validator.scriptHash) ||
        tx.outputs.some((row) => row.address === validator.address) ||
        tx.events.some((row) => row.validator === validator.family),
    ).map((tx) => ({
      txHash: tx.txHash,
      blockHeight: tx.blockHeight,
      txTime: tx.txTime,
      ioCount: tx.outputs.filter((row) => row.address === validator.address).length,
      executionCount: tx.redeemers.filter((row) => row.scriptHash === validator.scriptHash).length,
      eventCount: tx.events.filter((row) => row.validator === validator.family).length,
    }));
    const utxos = rich.outputs
      .filter((row) => row.address === validator.address)
      .map((row) => ({
        ...row,
        tx: { txHash: rich.txHash, blockHeight: rich.blockHeight, txTime: rich.txTime },
      }));
    const redeemers = L1_TXS.flatMap((tx) => tx.redeemers).filter(
      (row) => row.scriptHash === validator.scriptHash,
    );
    return json(res, {
      deployment: "fixture-deployment",
      validator,
      coverage: { limitedTo: 100, truncated: false },
      utxos,
      history,
      operations:
        redeemers.length === 0
          ? []
          : [
              {
                purpose: "spend",
                validContract: true,
                count: redeemers.length,
                memUnits: redeemers.reduce((sum, row) => sum + BigInt(row.memUnits), 0n).toString(),
                stepUnits: redeemers
                  .reduce((sum, row) => sum + BigInt(row.stepUnits), 0n)
                  .toString(),
                fee: redeemers.reduce((sum, row) => sum + BigInt(row.fee), 0n).toString(),
              },
            ],
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
