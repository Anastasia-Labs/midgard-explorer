/** Representative, not merely abundant. Every lifecycle state the status
 * registry knows about appears at least once, plus the awkward shapes:
 * undecodable rows, empty blocks, many-transaction blocks, multi-asset values,
 * and maximum-length identifiers. */

const hex = (seed, len) => {
  let out = "";
  let x = seed >>> 0;
  while (out.length < len) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out += x.toString(16).padStart(8, "0");
  }
  return out.slice(0, len);
};

export const txId = (n) => hex(n * 7919 + 11, 64);
export const blockHash = (n) => hex(n * 6271 + 3, 56);
export const l1TxHash = (n) => hex(n * 5231 + 17, 64);
export const eventId = (n) => hex(n * 4409 + 29, 64);

/** Addresses must carry a valid BIP-173 checksum: the app rejects malformed
 * ones in place, so a fixture with a made-up checksum would 404 rather than
 * exercise the address route. Generated here rather than hard-coded. */
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function bech32Encode(hrp, bytes) {
  let acc = 0;
  let bits = 0;
  const words = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  const mod = bech32Polymod([...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => BECH32_CHARSET[w]).join("")}`;
}

const addrBytes = (seed) => Array.from({ length: 29 }, (_, i) => (seed * 31 + i * 7 + 3) & 0xff);

export const ADDRESSES = [
  bech32Encode("addr_test", addrBytes(1)),
  bech32Encode("addr_test", addrBytes(2)),
  bech32Encode("addr_test", addrBytes(3)),
];

const value = (lovelace, assets = {}) => ({ lovelace: String(lovelace), assets });

const utf8Hex = (s) => Buffer.from(s, "utf8").toString("hex");

/** Asset names an explorer has to survive, not just the pleasant ones. A name
 * is bytes chosen by whoever minted the asset, so the set below includes the
 * two that matter for safety: bytes that are not valid UTF-8, and valid UTF-8
 * carrying a right-to-left override, which renders as a different name from
 * the one the ledger holds. Both must fall back to hex. */
export const ASSET_POLICIES = {
  plain: hex(101, 56),
  noName: hex(102, 56),
  hostile: hex(103, 56),
};

export const ASSET_NAMES = {
  /** "MIDGARD" */
  plain: utf8Hex("MIDGARD"),
  /** "PATATE", the CIP-14 spec's own example name. */
  patate: "504154415445",
  /** No name at all, which is different from an unreadable one. */
  empty: "",
  /** Not valid UTF-8. */
  binary: "fffe0102",
  /** "USD" + U+202E + "C": reads reversed, impersonating another token. */
  bidi: utf8Hex("USD‮C"),
};

const MULTI_ASSET = {
  [ASSET_POLICIES.plain]: {
    [ASSET_NAMES.plain]: "1",
    [ASSET_NAMES.patate]: "4500000000",
  },
  [ASSET_POLICIES.noName]: { [ASSET_NAMES.empty]: "7" },
  [ASSET_POLICIES.hostile]: {
    [ASSET_NAMES.binary]: "18446744073709551615",
    [ASSET_NAMES.bidi]: "42",
  },
};

/** A transaction view whose arithmetic is real.
 *
 * Fixture amounts used to be arbitrary, so inputs never equalled outputs plus
 * fee and the balanced case, which every genuine transaction satisfies, could
 * not be rendered at all. When every input resolves, the first output now
 * absorbs whatever the others and the fee leave over, so the equation holds.
 * When an input is unresolvable the amounts stay arbitrary, which is correct:
 * nothing can be checked in that case anyway. */
const view = (n, { pending = false, outputs = 2, validity = "TxIsValid" } = {}) => {
  const fee = 170000 + n * 1013;
  const inputA = 9_500_000 + n * 1000;
  // Most transactions keep one unresolvable input, the common case once a
  // transaction is applied. Every fourth resolves fully so the exact-spend
  // path, and with it the checkable equation, is exercised too.
  const allResolved = n % 4 === 0;
  const inputB = allResolved ? 3_400_000 + n * 500 : null;

  const tail = Array.from({ length: Math.max(0, outputs - 1) }, (_, i) => 2_100_000 + i * 500_000);
  const tailSum = tail.reduce((a, b) => a + b, 0);
  const remainder = inputA + (inputB ?? 0) - fee - tailSum;
  // A remainder that would be non-positive means the fixture cannot balance
  // this shape; fall back rather than emit a negative output.
  const balanced = allResolved && remainder > 0;
  const amounts = balanced
    ? [remainder, ...tail]
    : Array.from({ length: outputs }, (_, i) => 2_100_000 + i * 500_000);

  return {
  txId: txId(n),
  formatVersion: 1,
  validity,
  fee: String(fee),
  validityInterval: { start: n % 3 === 0 ? String(1000 + n) : null, end: null },
  networkId: 0,
  inputs: [
    {
      txId: txId(n + 500),
      index: 0,
      resolved: { address: ADDRESSES[n % ADDRESSES.length], value: value(inputA) },
    },
    {
      txId: txId(n + 900),
      index: 1,
      resolved:
        inputB === null
          ? null
          : { address: ADDRESSES[(n + 1) % ADDRESSES.length], value: value(inputB) },
    },
  ],
  referenceInputs: n % 4 === 0 ? [{ txId: txId(n + 77), index: 0 }] : [],
  outputs: amounts.map((lovelace, i) => ({
    address: ADDRESSES[(n + i) % ADDRESSES.length],
    value: i === 0 && n % 3 === 0 ? value(lovelace, MULTI_ASSET) : value(lovelace),
    hasDatum: i === 1,
    hasScriptRef: n % 5 === 0 && i === 0,
  })),
  mint: n % 6 === 0 ? { policyIds: [hex(303, 56), hex(304, 56)] } : null,
  witnesses: { vkeyCount: 1 + (n % 3), scriptCount: n % 2, redeemerCount: n % 2 },
  ...(pending ? { pending: true } : {}),
  };
};

/** Blocks 1..40; block 3 is empty, block 5 carries many transactions. */
export const BLOCKS = Array.from({ length: 40 }, (_, i) => {
  const height = 40 - i;
  return {
    height,
    header_hash: blockHash(height),
    tx_id: txId(height),
    time_stamp_tz: new Date(Date.UTC(2026, 6, 28, 12, 0, 0) - i * 21_000).toISOString(),
  };
});

const txCountForBlock = (height) => (height === 3 ? 0 : height === 5 ? 12 : 2);

export const blockRows = (height) =>
  Array.from({ length: txCountForBlock(height) }, (_, i) => {
    const n = height * 100 + i;
    const undecodable = height === 7 && i === 1;
    return {
      height,
      header_hash: blockHash(height),
      tx_id: txId(n),
      time_stamp_tz: new Date(
        Date.UTC(2026, 6, 28, 12, 0, 0) - (40 - height) * 21_000,
      ).toISOString(),
      transaction: undecodable ? null : view(n),
      decodeError: undecodable ? "unsupported output encoding (legacy CML)" : null,
    };
  });

export const blockDa = (height) =>
  height === 9
    ? null
    : {
        utxos_root: hex(height * 11 + 1, 64),
        transactions_root: hex(height * 11 + 2, 64),
        deposits_root: hex(height * 11 + 3, 64),
        withdrawals_root: hex(height * 11 + 4, 64),
        forced_transactions_root: hex(height * 11 + 5, 64),
        transition_trace_root: hex(height * 11 + 6, 64),
        event_to_step_root: hex(height * 11 + 7, 64),
        l2_transaction_count: txCountForBlock(height),
        deposit_count: height % 3,
        withdrawal_count: height % 2,
        forced_transaction_count: height % 4 === 0 ? 1 : 0,
        total_event_count: txCountForBlock(height) + (height % 3) + (height % 2),
        transition_step_count: txCountForBlock(height) * 2,
        block_start_time: new Date(Date.UTC(2026, 6, 28, 11, 59, 40)).toISOString(),
        block_end_time: new Date(Date.UTC(2026, 6, 28, 12, 0, 0)).toISOString(),
      };

/** Every finalization status the registry knows, cycled across blocks, plus one
 * the registry does not know. Transactions already exercise an unrecognized
 * lifecycle status via TX_STATUSES; blocks had no equivalent, so the
 * unknown-settlement-stage path had never rendered.
 *
 * The length matters. Transaction n sits in block (40 - n), so a cycle the same
 * length as TX_STATUSES phase-locks the two: with seven entries, every single
 * committed transaction landed in an abandoned block, and "committed, awaiting
 * L1 finality" (the most common real state there is) could not be produced at
 * all. Eight entries are co-prime with the seven lifecycle statuses, so every
 * pairing occurs. `finalized` appears twice, which is both what makes the
 * length eight and a fair weighting: most blocks do settle. */
const FINALIZATION_STATUSES = [
  "finalized",
  "observed_waiting_stability",
  "submitted_unconfirmed",
  "submitted_local_finalization_pending",
  "pending_submission",
  "abandoned",
  "some_future_finalization_stage",
  "finalized",
];

export const blockFinalization = (height) => {
  if (height === 11) return null;
  const status = FINALIZATION_STATUSES[height % FINALIZATION_STATUSES.length];
  const blockEndMs = Date.UTC(2026, 6, 28, 12, 0, 0) - (40 - height) * 21_000;
  const createdMs = blockEndMs + 1_400;
  const observed =
    status === "observed_waiting_stability" || status === "finalized"
      ? new Date(createdMs + 18_000).toISOString()
      : null;
  const updatedMs =
    status === "finalized"
      ? createdMs + 42_000
      : status === "abandoned"
        ? createdMs + 35_000
        : observed
          ? new Date(observed).getTime()
          : createdMs + 4_000;
  return {
    status,
    submitted_tx_hash: status === "pending_submission" ? null : l1TxHash(height),
    blockEndTime: new Date(blockEndMs).toISOString(),
    createdAt: new Date(createdMs).toISOString(),
    updatedAt: new Date(updatedMs).toISOString(),
    observedConfirmedAt: observed,
  };
};

/** Transaction lifecycle: one of every known status, plus an unknown one so the
 * "unrecognized status" path is exercised. */
export const TX_STATUSES = [
  "committed",
  "pending_commit",
  "accepted",
  "validating",
  "queued",
  "rejected",
  "some_future_status",
];

export const TXS = Array.from({ length: 60 }, (_, i) => {
  const n = i + 1;
  const status = TX_STATUSES[i % TX_STATUSES.length];
  // Only a transaction that reached a ledger tier has a body to decode, so a
  // rejected or still-admitting one can never also be undecodable.
  const undecodable = i % 17 === 5 && ["committed", "pending_commit", "accepted"].includes(status);
  const txTimeMs = Date.UTC(2026, 6, 28, 12, 0, 0) - i * 37_000;
  const firstSeenMs = txTimeMs - 24_000;
  const admissionStatus =
    status === "queued" || status === "validating" || status === "rejected" ? status : "accepted";
  const validationStartedAt =
    admissionStatus === "queued" ? null : new Date(firstSeenMs + 1_700).toISOString();
  const terminalAt =
    admissionStatus === "accepted" || admissionStatus === "rejected"
      ? new Date(firstSeenMs + 5_900).toISOString()
      : null;
  const updatedAt = terminalAt ?? validationStartedAt ?? new Date(firstSeenMs).toISOString();
  return {
    n,
    status,
    header_hash: blockHash(40 - (i % 40)),
    tx_id: txId(n),
    time_stamp_tz: new Date(txTimeMs).toISOString(),
    admission: {
      status: admissionStatus,
      firstSeenAt: new Date(firstSeenMs).toISOString(),
      validationStartedAt,
      terminalAt,
      updatedAt,
      attemptCount: admissionStatus === "queued" ? 0 : 1,
      requestCount: n % 5 === 0 ? 2 : 1,
      submitSource: n % 9 === 0 ? "backfill" : "native",
    },
    transaction: undecodable ? null : view(n, { pending: status !== "committed" }),
    decodeError: undecodable ? "unsupported output encoding (legacy CML)" : null,
  };
});

const BRIDGE_STATUSES = ["awaiting", "projected", "consumed", "finalized"];

export const DEPOSITS = Array.from({ length: 47 }, (_, i) => ({
  event_id: eventId(i + 1),
  deposit_l1_tx_hash: l1TxHash(i + 1),
  ledger_tx_id: txId(i + 200),
  ledger_address: ADDRESSES[i % ADDRESSES.length],
  status: BRIDGE_STATUSES[i % BRIDGE_STATUSES.length],
  inclusion_time: new Date(Date.UTC(2026, 6, 28, 11, 0, 0) - i * 61_000).toISOString(),
  projected_header_hash: i % 5 === 0 ? null : blockHash(40 - (i % 40)),
  value: i % 11 === 3 ? null : value(25_000_000 + i * 130_000, i % 4 === 0 ? MULTI_ASSET : {}),
}));

const WITHDRAWAL_VALIDITY = [
  "WithdrawalIsValid",
  "NonExistentWithdrawalUtxo",
  "SpentWithdrawalUtxo",
  "IncorrectWithdrawalOwner",
  "IncorrectWithdrawalValue",
  "IncorrectWithdrawalSignature",
  "TooManyTokensInWithdrawal",
  "UnpayableWithdrawalValue",
];

export const WITHDRAWALS = Array.from({ length: 39 }, (_, i) => ({
  event_id: eventId(i + 500),
  withdrawal_l1_tx_hash: l1TxHash(i + 500),
  withdrawal_l1_output_index: i % 4,
  l2_outref: txId(i + 700),
  l2_value: i % 9 === 4 ? null : value(12_000_000 + i * 90_000),
  l1_address: hex(i * 31 + 7, 58),
  validity: i % 7 === 2 ? null : WITHDRAWAL_VALIDITY[i % WITHDRAWAL_VALIDITY.length],
  status: BRIDGE_STATUSES[i % BRIDGE_STATUSES.length],
  inclusion_time: new Date(Date.UTC(2026, 6, 28, 10, 30, 0) - i * 73_000).toISOString(),
  projected_header_hash: i % 6 === 0 ? null : blockHash(40 - (i % 40)),
}));

const FORCED_VALIDITY = [
  "TxIsValid",
  "NonExistentInputUtxo",
  "InvalidSignature",
  "FailedScript",
  "FeeTooLow",
  "UnbalancedTx",
];

export const FORCED = Array.from({ length: 28 }, (_, i) => ({
  tx_order_id: eventId(i + 900),
  tx_order_l1_tx_hash: l1TxHash(i + 900),
  tx_order_l1_output_index: i % 3,
  tx_id: txId(i + 1100),
  operator_validity: FORCED_VALIDITY[i % FORCED_VALIDITY.length],
  status: BRIDGE_STATUSES[i % BRIDGE_STATUSES.length],
  inclusion_time: new Date(Date.UTC(2026, 6, 28, 9, 45, 0) - i * 97_000).toISOString(),
  projected_header_hash: i % 4 === 0 ? null : blockHash(40 - (i % 40)),
}));

export const addressResponse = (address) => {
  const history = TXS.filter((t) => t.transaction).slice(0, 9);
  const undecodedOutputs = address === ADDRESSES[1] ? 3 : 0;
  const rows = history.map((t, i) => {
    const block = BLOCKS.find((b) => b.header_hash === t.header_hash) ?? null;
    // Received reads this transaction's own outputs, so it is always exact.
    const received = t.transaction.outputs
      .filter((o) => o.address === address)
      .reduce((sum, o) => sum + BigInt(o.value.lovelace), 0n)
      .toString();
    // Every third row keeps an unresolved input, the common real case once a
    // transaction has been applied and its inputs have left the ledger.
    const spentComplete = i % 3 !== 0 && t.transaction.inputs.every((x) => x.resolved !== null);
    const spent = spentComplete
      ? t.transaction.inputs
          .filter((x) => x.resolved?.address === address)
          .reduce((sum, x) => sum + BigInt(x.resolved.value.lovelace), 0n)
          .toString()
      : null;
    return {
      tx_id: t.tx_id,
      address,
      height: block?.height ?? null,
      header_hash: block?.header_hash ?? null,
      time_stamp_tz: t.time_stamp_tz,
      status: t.status === "pending_commit" ? "pending_commit" : "committed",
      received,
      spent,
      spentComplete,
      transaction: t.transaction,
      decodeError: t.decodeError,
    };
  });
  const times = rows.map((r) => new Date(r.time_stamp_tz).getTime());
  // The UTxOs behind the balance, including one the codec cannot read: an
  // address holding six entries of which one is unreadable must show six rows
  // and a warning, not five rows and a quietly smaller total.
  const utxos = Array.from({ length: 6 }, (_, i) => {
    const broken = undecodedOutputs > 0 && i === 4;
    return {
      txId: broken ? null : txId(700 + i),
      index: broken ? null : i % 3,
      outRefHex: hex(900 + i, 72),
      value: broken ? null : value(20_000_000 + i * 1_500_000, i === 1 ? MULTI_ASSET : {}),
      hasDatum: i === 2,
      hasScriptRef: i === 5,
      decodeError: broken ? "unsupported output encoding (legacy CML)" : null,
    };
  });

  return {
    balance: value(184_250_000, MULTI_ASSET),
    undecodedOutputs,
    utxoCount: utxos.length,
    utxos,
    txCount: rows.length,
    firstActivity: new Date(Math.min(...times)).toISOString(),
    latestActivity: new Date(Math.max(...times)).toISOString(),
    history: rows,
  };
};

/** Operational metrics, shaped exactly like GET /api/metrics.
 *
 * Counts are derived from the fixture rows above, so the panel and the list
 * pages cannot disagree. Two things are deliberately arranged rather than
 * derived, because they are UI states that need exercising and the fixture's
 * fourteen minutes of history would never produce them:
 *
 *   - the hourly series spans a full day and contains one empty hour, so the
 *     chart's treatment of an outage is under test rather than assumed;
 *   - the settlement-latency sample is small, which is the case where a p95
 *     must be presented as too thin to trust rather than as a measurement.
 *
 * `partial` is true and honest: the fixture's blocks cover minutes, not a day.
 */
export const metrics = () => {
  const end = new Date(Date.UTC(2026, 6, 28, 12, 0, 0));
  const start = new Date(end.getTime() - 24 * 3_600_000);
  const observedFrom = new Date(end.getTime() - (BLOCKS.length - 1) * 21_000);

  const txTotal = BLOCKS.reduce((n, b) => n + txCountForBlock(b.height), 0);
  const terminal = TXS.filter((t) => t.admission?.terminalAt);
  const accepted = terminal.filter((t) => t.admission.status === "accepted").length;
  const rejected = terminal.filter((t) => t.admission.status === "rejected").length;
  const queueDepth = TXS.filter((t) =>
    ["queued", "validating"].includes(t.admission?.status),
  ).length;

  const finalizations = BLOCKS.map((b) => blockFinalization(b.height)).filter((f) => f !== null);
  const byStatus = (s) => finalizations.filter((f) => f.status === s).length;
  const unsettled = finalizations.filter(
    (f) => !["finalized", "abandoned"].includes(f.status),
  );
  const oldest = unsettled
    .slice()
    .sort((a, b) => new Date(a.blockEndTime) - new Date(b.blockEndTime))[0];
  const oldestBlock = BLOCKS.find(
    (b) => blockFinalization(b.height)?.blockEndTime === oldest?.blockEndTime,
  );

  const statusCounts = (list, key) => {
    const seen = new Map();
    for (const item of list) seen.set(item[key], (seen.get(item[key]) ?? 0) + 1);
    return [...seen.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  };

  const series = Array.from({ length: 25 }, (_, i) => {
    const hour = new Date(start.getTime() + i * 3_600_000);
    // Hour 9 is an outage: no blocks produced. A chart that silently bridges
    // this gap is hiding the one thing an operator opened the page for.
    const blocks = i === 9 ? 0 : 6 + ((i * 5) % 7);
    return {
      hour: hour.toISOString(),
      blocks,
      transactions: blocks * 2 + (i % 3),
    };
  });

  return {
    window: {
      hours: 24,
      start: start.toISOString(),
      end: end.toISOString(),
      observedFrom: observedFrom.toISOString(),
      partial: true,
    },
    tip: {
      height: BLOCKS[0].height,
      at: BLOCKS[0].time_stamp_tz,
      ageSeconds: 12,
      source: "blocks.height, blocks.time_stamp_tz",
    },
    throughput: {
      transactions: txTotal,
      blocks: BLOCKS.length,
      transactionsPerBlock: txTotal / BLOCKS.length,
      blockIntervalSeconds: { p50: 21, p95: 21, sampleCount: BLOCKS.length - 1 },
      source: "blocks.time_stamp_tz, blocks.header_hash",
    },
    admission: {
      latency: {
        p50Ms: 5900,
        p95Ms: 5900,
        sampleCount: terminal.length,
        source: "tx_admissions.terminal_at - tx_admissions.first_seen_at",
      },
      accepted,
      rejected,
      rejectionRate: terminal.length === 0 ? null : rejected / terminal.length,
      queueDepth,
      source: "tx_admissions.status, tx_admissions.terminal_at",
    },
    finality: {
      settlementLatency: {
        p50Ms: 43_400,
        p95Ms: 61_200,
        sampleCount: byStatus("finalized"),
        source:
          "pending_block_finalizations.updated_at - pending_block_finalizations.block_end_time",
      },
      finalized: byStatus("finalized"),
      pending: unsettled.length,
      abandoned: byStatus("abandoned"),
      oldestUnsettled:
        oldest === undefined
          ? null
          : {
              headerHash: oldestBlock?.header_hash ?? blockHash(1),
              status: oldest.status,
              blockEndTime: oldest.blockEndTime,
              waitingSeconds: Math.round(
                (end.getTime() - new Date(oldest.blockEndTime).getTime()) / 1000,
              ),
            },
      source: "pending_block_finalizations.status, pending_block_finalizations.block_end_time",
    },
    statusBreakdown: {
      finalization: statusCounts(finalizations, "status"),
      admission: statusCounts(
        TXS.filter((t) => t.admission).map((t) => t.admission),
        "status",
      ),
    },
    series,
  };
};

/** The asset roster and per-asset holdings, derived from MULTI_ASSET so the
 * asset pages and the values shown on transactions cannot disagree. Coverage
 * is reported complete here: the fixture ledger is small enough to scan whole,
 * which is the case the UI must handle without warning about a partial answer. */
const ASSET_ROWS = Object.entries(MULTI_ASSET).flatMap(([policyId, names]) =>
  Object.entries(names).map(([assetName, quantity], i) => ({
    policyId,
    assetName,
    ledgerQuantity: quantity,
    holderCount: (i % ADDRESSES.length) + 1,
    utxoCount: (i % 3) + 1,
  })),
);

const COVERAGE = { scanned: 128, total: 128, truncated: false, undecoded: 0 };

export const assets = () => ({
  rows: ASSET_ROWS.slice().sort((a, b) => b.holderCount - a.holderCount),
  total: ASSET_ROWS.length,
  coverage: COVERAGE,
});

export const asset = (policyId, assetName) => {
  const row = ASSET_ROWS.find(
    (r) => r.policyId === policyId && r.assetName === (assetName ?? ""),
  );
  if (!row) return null;
  return {
    policyId: row.policyId,
    assetName: row.assetName,
    ledgerQuantity: row.ledgerQuantity,
    holderCount: row.holderCount,
    holders: ADDRESSES.slice(0, row.holderCount).map((address, i) => ({
      address,
      // Split the quantity so the largest-first ordering is exercised rather
      // than assumed; BigInt because a supply can exceed 2^53.
      quantity: (BigInt(row.ledgerQuantity) / BigInt(row.holderCount) + BigInt(i === 0 ? 1 : 0))
        .toString(),
      utxoCount: (i % 2) + 1,
    })),
    holdersTruncated: false,
    coverage: COVERAGE,
  };
};
